/**
 * routes/event-queue.js — Event Queue + Rule Engine API (v19.1)
 */
const router = require('express').Router();
const { pool } = require('../db');
const { publish: publishEvent, processEventRules } = require('../services/eventBus');
const { createLogger } = require('../utils/logger');
const { isDeepStrictEqual } = require('node:util');
const { authenticateToken, canUseAction, requireAction } = require('../middleware/auth');
const {
    installRevenueResponseShaper,
    isFinancialFieldKey,
    redactRevenueFields
} = require('../services/revenueAccessPolicy');

const log = createLogger('EventQueue');
const requireSettingsManagement = requireAction('manage_settings');
const FINANCIAL_EVENT_TOKENS = new Set([
    'amount', 'billing', 'budget', 'cashflow', 'commission', 'cost', 'debt',
    'discount', 'expense', 'fee', 'finance', 'financial', 'gross', 'income',
    'invoice', 'ltv', 'margin', 'markup', 'money', 'net', 'payment', 'payroll',
    'price', 'profit', 'refund', 'revenue', 'spent', 'subtotal', 'tax', 'turnover'
]);
const FINANCIAL_POINTER_KEYS = new Set(['column', 'field', 'key', 'metric', 'path', 'property']);
const FULL_PAYLOAD_SINK_ACTIONS = new Set(['create_print_job']);
const NON_REFERENCE_DOTTED_SUFFIXES = new Set(['app', 'com', 'dev', 'io', 'local', 'net', 'org', 'ua']);
const RESTRICTED_EVENT_DETAIL_KEYS = new Set([
    'payload', 'conditions', 'actions', 'name', 'description', 'error', 'last_error',
    'lastError', 'output', 'idempotency_key', 'idempotencyKey', 'terminal_reason', 'terminalReason'
]);

function hasFinancialEventType(eventType) {
    const source = String(eventType || '');
    if (isFinancialFieldKey(source) || source.trim().toLowerCase() === 'deposit') return true;
    return source
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .some(token => FINANCIAL_EVENT_TOKENS.has(token));
}

function isPlainObject(value) {
    if (!value || Object.prototype.toString.call(value) !== '[object Object]') return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function normalizeJsonContainersForInspection(value) {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        const looksLikeContainer = (trimmed.startsWith('{') && trimmed.endsWith('}'))
            || (trimmed.startsWith('[') && trimmed.endsWith(']'));
        if (!looksLikeContainer) return value;
        try {
            const parsed = JSON.parse(trimmed);
            return parsed && typeof parsed === 'object'
                ? normalizeJsonContainersForInspection(parsed)
                : value;
        } catch {
            return value;
        }
    }
    if (Array.isArray(value)) return value.map(normalizeJsonContainersForInspection);
    if (!value || typeof value !== 'object') return value;
    if (value instanceof Date || Buffer.isBuffer(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([key, nestedValue]) => [
        key,
        normalizeJsonContainersForInspection(nestedValue)
    ]));
}

function containsFinancialPointer(value) {
    if (Array.isArray(value)) return value.some(containsFinancialPointer);
    if (!value || typeof value !== 'object') return false;
    return Object.entries(value).some(([key, nestedValue]) => {
        if (FINANCIAL_POINTER_KEYS.has(String(key).toLowerCase())
            && typeof nestedValue === 'string'
            && hasFinancialEventType(nestedValue)) {
            return true;
        }
        return containsFinancialPointer(nestedValue);
    });
}

function containsFinancialTemplateReference(value) {
    if (typeof value === 'string') {
        const bracedReferences = [...value.matchAll(/\{\{?\s*([^{}]+?)\s*\}\}?/g)];
        if (bracedReferences.some(match => hasFinancialEventType(match[1]))) return true;

        const textWithoutNetworkAddresses = value
            .replace(/\b(?:https?|ftp):\/\/[^\s<>"']+/giu, ' ')
            .replace(/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/giu, ' ');
        const assignedReferences = [...textWithoutNetworkAddresses.matchAll(/\b([a-z][a-z0-9_-]*)\s*(?==|:)/giu)];
        if (assignedReferences.some(match => hasFinancialEventType(match[1]))) return true;

        const dottedReferences = [
            ...textWithoutNetworkAddresses.matchAll(/\b[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+\b/giu)
        ];
        return dottedReferences.some(match => {
            const reference = match[0];
            const suffix = reference.split('.').at(-1).toLowerCase();
            return !NON_REFERENCE_DOTTED_SUFFIXES.has(suffix) && hasFinancialEventType(reference);
        });
    }
    if (Array.isArray(value)) return value.some(containsFinancialTemplateReference);
    if (!value || typeof value !== 'object') return false;
    return Object.values(value).some(containsFinancialTemplateReference);
}

function containsFullPayloadSink(actions) {
    if (!Array.isArray(actions)) return false;
    return actions.some(action => isPlainObject(action)
        && FULL_PAYLOAD_SINK_ACTIONS.has(String(action.type || '').trim().toLowerCase()));
}

function isFinancialEventPayload(eventType, payload) {
    const inspectablePayload = normalizeJsonContainersForInspection(payload);
    return hasFinancialEventType(eventType)
        || containsFinancialPointer(inspectablePayload)
        || containsFinancialTemplateReference(inspectablePayload)
        || !isDeepStrictEqual(inspectablePayload, redactRevenueFields(inspectablePayload));
}

function isFinancialRuleDefinition(eventType, conditions, actions, metadata = {}) {
    const normalizedConditions = normalizeJsonContainersForInspection(conditions);
    const normalizedActions = normalizeJsonContainersForInspection(actions);
    return isFinancialEventPayload(eventType, {
        name: metadata.name,
        description: metadata.description,
        conditions: normalizedConditions,
        actions: normalizedActions
    }) || containsFullPayloadSink(normalizedActions);
}

function rejectFinancialEventWithoutRevenueAccess(req, res, eventType, payload) {
    if (canUseAction(req.user, 'view_revenue') || !isFinancialEventPayload(eventType, payload)) {
        return false;
    }
    res.status(403).json({ error: 'Insufficient permissions' });
    return true;
}

function rejectFinancialRuleWithoutRevenueAccess(req, res, eventType, conditions, actions, metadata = {}) {
    if (canUseAction(req.user, 'view_revenue')
        || !isFinancialRuleDefinition(eventType, conditions, actions, metadata)) {
        return false;
    }
    res.status(403).json({ error: 'Insufficient permissions' });
    return true;
}

function projectFinancialEventBodies(value) {
    if (Array.isArray(value)) return value.map(projectFinancialEventBodies);
    if (!value || typeof value !== 'object') return value;
    if (value instanceof Date || Buffer.isBuffer(value)) return value;

    const eventType = value.event_type || value.eventType || value.trigger_event || value.triggerEvent;
    const isRuleDefinition = (
        Object.prototype.hasOwnProperty.call(value, 'trigger_event')
        || Object.prototype.hasOwnProperty.call(value, 'triggerEvent')
    ) && (
        Object.prototype.hasOwnProperty.call(value, 'conditions')
        || Object.prototype.hasOwnProperty.call(value, 'actions')
    );
    const hideEventBody = isRuleDefinition
        ? isFinancialRuleDefinition(eventType, value.conditions, value.actions, {
            name: value.name,
            description: value.description
        })
        : isFinancialEventPayload(eventType, {
            payload: value.payload,
            output: value.output,
            error: value.error,
            last_error: value.last_error,
            lastError: value.lastError,
            idempotency_key: value.idempotency_key,
            idempotencyKey: value.idempotencyKey,
            terminal_reason: value.terminal_reason,
            terminalReason: value.terminalReason
        });
    const projected = {};
    for (const [key, nestedValue] of Object.entries(value)) {
        if (hideEventBody && RESTRICTED_EVENT_DETAIL_KEYS.has(key)) continue;
        projected[key] = projectFinancialEventBodies(nestedValue);
    }
    if (hideEventBody) projected.detailsRestricted = true;
    return projected;
}

async function requireStoredRuleRevenueAccess(req, res, next) {
    if (canUseAction(req.user, 'view_revenue')) return next();
    try {
        const existing = await pool.query(
            'SELECT name, description, trigger_event, conditions, actions FROM rule_definitions WHERE id = $1',
            [req.params.id]
        );
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Правило не знайдено' });
        }
        const currentRule = existing.rows[0];
        if (rejectFinancialRuleWithoutRevenueAccess(
            req, res, currentRule.trigger_event, currentRule.conditions, currentRule.actions, {
                name: currentRule.name,
                description: currentRule.description
            }
        )) return;
        return next();
    } catch (err) {
        log.error('Stored rule access check error', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}

function requireRuleBodyRevenueAccess(req, res, next) {
    const { name, description, trigger_event, conditions, actions } = req.body || {};
    if (rejectFinancialRuleWithoutRevenueAccess(
        req, res, trigger_event, conditions, actions, { name, description }
    )) return;
    return next();
}

function requirePlainEventPayload(req, res, next) {
    const body = isPlainObject(req.body) ? req.body : {};
    const hasPayload = Object.prototype.hasOwnProperty.call(body, 'payload');
    const payload = hasPayload ? body.payload : {};
    if (!isPlainObject(payload)) {
        return res.status(400).json({ error: 'payload має бути JSON-об’єктом' });
    }
    req.body = { ...body, payload };
    return next();
}

function requireRuleContainers(req, res, next) {
    const body = isPlainObject(req.body) ? req.body : {};
    const hasConditions = Object.prototype.hasOwnProperty.call(body, 'conditions');
    const hasActions = Object.prototype.hasOwnProperty.call(body, 'actions');
    const conditions = hasConditions ? body.conditions : {};
    const actions = hasActions ? body.actions : [];
    if (!isPlainObject(conditions)) {
        return res.status(400).json({ error: 'conditions має бути JSON-об’єктом' });
    }
    if (!Array.isArray(actions)) {
        return res.status(400).json({ error: 'actions має бути JSON-масивом' });
    }
    req.body = { ...body, conditions, actions };
    return next();
}

// All event-queue routes require authentication
router.use(authenticateToken);
router.use((req, res, next) => installRevenueResponseShaper(
    req,
    res,
    next,
    canUseAction(req.user, 'view_revenue')
));

function shapeReadOnlyEventRevenueText(req, res, next) {
    if (canUseAction(req.user, 'view_revenue')) return next();
    const sendJson = res.json.bind(res);
    res.json = payload => sendJson(redactRevenueFields(projectFinancialEventBodies(payload)));
    return next();
}

function shapeEventRuleRevenue(req, res, next) {
    if (canUseAction(req.user, 'view_revenue')) return next();
    const sendJson = res.json.bind(res);
    res.json = payload => sendJson(projectFinancialEventBodies(payload));
    return next();
}

// ============================================
// Event Queue
// ============================================

// POST /api/events/publish — publish event to queue (uses eventBus)
router.post('/publish', requirePlainEventPayload, async (req, res) => {
    try {
        const { event_type, payload, idempotency_key } = req.body;
        if (!event_type) {
            return res.status(400).json({ error: 'event_type обов\'язковий' });
        }
        if (rejectFinancialEventWithoutRevenueAccess(
            req, res, event_type, { payload, idempotency_key }
        )) return;

        const event = await publishEvent(event_type, payload, idempotency_key);
        if (!event) {
            return res.json({ success: true, duplicate: true, message: 'Подія з таким ключем вже існує' });
        }

        res.json({ success: true, event });
    } catch (err) {
        log.error('Publish event error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/events — list events
router.get('/', shapeReadOnlyEventRevenueText, async (req, res) => {
    try {
        const { status, event_type, limit: lim } = req.query;
        let query = 'SELECT * FROM event_queue';
        const conditions = [];
        const params = [];
        if (status) { params.push(status); conditions.push(`status = $${params.length}`); }
        if (event_type) { params.push(event_type); conditions.push(`event_type = $${params.length}`); }
        if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
        query += ` ORDER BY created_at DESC LIMIT ${parseInt(lim) || 50}`;
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        log.error('List events error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/events/overview — queue dashboard
router.get('/overview', shapeReadOnlyEventRevenueText, async (req, res) => {
    try {
        const [queue, deadLetter, rules, executions] = await Promise.all([
            pool.query(`SELECT
                COUNT(*) FILTER (WHERE status = 'pending') as pending,
                COUNT(*) FILTER (WHERE status = 'processed') as processed,
                COUNT(*) FILTER (WHERE status = 'failed') as failed,
                COUNT(*) as total
             FROM event_queue`),
            pool.query('SELECT COUNT(*) as count FROM event_dead_letter'),
            pool.query(`SELECT
                COUNT(*) FILTER (WHERE is_active) as active,
                COUNT(*) as total
             FROM rule_definitions`),
            pool.query(`SELECT
                COUNT(*) FILTER (WHERE result = 'success') as success,
                COUNT(*) FILTER (WHERE result = 'error') as errors,
                COUNT(*) as total
             FROM rule_execution_log WHERE executed_at > NOW() - INTERVAL '24 hours'`)
        ]);

        res.json({
            queue: queue.rows[0],
            dead_letter: deadLetter.rows[0],
            rules: rules.rows[0],
            executions_24h: executions.rows[0]
        });
    } catch (err) {
        log.error('Overview error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/events/:id/retry — retry failed event
router.post('/:id/retry', async (req, res) => {
    try {
        const queued = await pool.query(
            `SELECT event_type, payload, output, error, last_error, idempotency_key, terminal_reason
             FROM event_queue WHERE id = $1 AND status = 'failed'`,
            [req.params.id]
        );
        if (queued.rows.length === 0) {
            return res.status(404).json({ error: 'Подію не знайдено або вона не в статусі failed' });
        }
        const queuedEvent = queued.rows[0];
        if (rejectFinancialEventWithoutRevenueAccess(req, res, queuedEvent.event_type, queuedEvent)) return;
        const result = await pool.query(
            `UPDATE event_queue SET status = 'pending', attempts = 0, last_error = NULL, next_retry_at = NULL
             WHERE id = $1 AND status = 'failed' RETURNING *`,
            [req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Подію не знайдено або вона не в статусі failed' });
        }
        res.json({ success: true, event: result.rows[0] });
    } catch (err) {
        log.error('Retry event error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/events/dead-letter — dead letter queue
router.get('/dead-letter', shapeReadOnlyEventRevenueText, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM event_dead_letter ORDER BY moved_at DESC LIMIT 50');
        res.json(result.rows);
    } catch (err) {
        log.error('Dead letter error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================
// Rule Engine
// ============================================

// GET /api/events/rules — list rules
router.get('/rules', requireSettingsManagement, shapeEventRuleRevenue, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM rule_definitions ORDER BY priority DESC, created_at LIMIT 500');
        res.json(result.rows);
    } catch (err) {
        log.error('List rules error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/events/rules — create rule
router.post('/rules', requireSettingsManagement, requireRuleContainers, requireRuleBodyRevenueAccess, async (req, res) => {
    try {
        const { code, name, description, trigger_event, conditions, actions, priority } = req.body;
        if (!code || !name || !trigger_event) {
            return res.status(400).json({ error: 'code, name, trigger_event обов\'язкові' });
        }

        const result = await pool.query(
            `INSERT INTO rule_definitions (code, name, description, trigger_event, conditions, actions, priority, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [code, name, description || null, trigger_event,
             JSON.stringify(conditions || {}), JSON.stringify(actions || []),
             priority || 0, req.user?.username || 'system']
        );

        log.info(`Rule created: ${code}`);
        res.json({ success: true, rule: result.rows[0] });
    } catch (err) {
        if (err.constraint === 'rule_definitions_code_key') {
            return res.status(400).json({ error: 'Правило з таким кодом вже існує' });
        }
        log.error('Create rule error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/events/rules/:id — update rule
router.put('/rules/:id', requireSettingsManagement, requireRuleContainers, requireRuleBodyRevenueAccess, requireStoredRuleRevenueAccess, async (req, res) => {
    try {
        const { name, description, trigger_event, conditions, actions, priority, is_active } = req.body;
        const result = await pool.query(
            `UPDATE rule_definitions SET name=$1, description=$2, trigger_event=$3,
             conditions=$4, actions=$5, priority=$6, is_active=$7, updated_at=NOW()
             WHERE id=$8 RETURNING *`,
            [name, description, trigger_event, JSON.stringify(conditions || {}),
             JSON.stringify(actions || []), priority || 0, is_active !== false, req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Правило не знайдено' });
        }
        res.json({ success: true, rule: result.rows[0] });
    } catch (err) {
        log.error('Update rule error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/events/rules/:id — delete rule
router.delete('/rules/:id', requireSettingsManagement, requireStoredRuleRevenueAccess, async (req, res) => {
    try {
        await pool.query('DELETE FROM rule_definitions WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        log.error('Delete rule error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/events/rules/log — execution log
router.get('/rules/log', requireSettingsManagement, shapeReadOnlyEventRevenueText, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT rel.*
             FROM rule_execution_log rel
             ORDER BY rel.executed_at DESC LIMIT 100`
        );
        res.json(result.rows);
    } catch (err) {
        log.error('Rule log error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;

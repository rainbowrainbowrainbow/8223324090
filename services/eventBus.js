/**
 * services/eventBus.js — Universal Event Publisher (v19.1)
 *
 * Bridge between application modules and the Event Queue.
 * Any module can publish events; the Rule Engine processes them.
 *
 * Usage:
 *   const { publish } = require('../services/eventBus');
 *   await publish('booking.created', { booking_id: 'BK-2026-0001', room: 'VIP' });
 */
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');

const log = createLogger('EventBus');

/**
 * Publish an event to the event queue.
 * Idempotency key is auto-generated if not provided.
 * Returns the created event row (or null if duplicate).
 */
async function publish(eventType, payload, idempotencyKey) {
    try {
        const key = idempotencyKey || `${eventType}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        const result = await pool.query(
            `INSERT INTO event_queue (event_type, payload, idempotency_key)
             VALUES ($1, $2, $3)
             ON CONFLICT (idempotency_key) DO NOTHING
             RETURNING *`,
            [eventType, JSON.stringify(payload || {}), key]
        );

        if (result.rows.length === 0) {
            log.debug(`Event duplicate skipped: ${eventType} (key: ${key})`);
            return null;
        }

        const event = result.rows[0];

        // Process rules for this event (fire-and-forget)
        processEventRules(event).catch(err =>
            log.error(`Rule processing failed for event ${event.id}: ${err.message}`)
        );

        log.info(`Event published: ${eventType} (id: ${event.id})`);
        return event;
    } catch (err) {
        log.error(`Publish failed: ${eventType} — ${err.message}`);
        return null;
    }
}

/**
 * Process rules matching an event. Executes real actions.
 */
async function processEventRules(event) {
    let applied = 0;
    try {
        const rules = await pool.query(
            `SELECT * FROM rule_definitions WHERE trigger_event = $1 AND is_active = true ORDER BY priority DESC`,
            [event.event_type]
        );

        for (const rule of rules.rows) {
            try {
                // Check conditions against payload
                const payload = typeof event.payload === 'string' ? JSON.parse(event.payload) : (event.payload || {});
                if (rule.conditions && Object.keys(rule.conditions).length > 0) {
                    const conditions = typeof rule.conditions === 'string' ? JSON.parse(rule.conditions) : rule.conditions;
                    const match = Object.entries(conditions).every(([k, v]) => payload[k] === v);
                    if (!match) continue;
                }

                // Execute actions
                const actions = typeof rule.actions === 'string' ? JSON.parse(rule.actions) : (rule.actions || []);
                let actionsExecuted = 0;

                for (const action of actions) {
                    try {
                        await executeAction(action, payload, event);
                        actionsExecuted++;
                    } catch (actionErr) {
                        log.error(`Action ${action.type} failed for rule ${rule.code}: ${actionErr.message}`);
                    }
                }

                // Log successful execution
                await pool.query(
                    `INSERT INTO rule_execution_log (rule_id, trigger_event, result, output)
                     VALUES ($1, $2, 'success', $3)`,
                    [rule.id, event.event_type, JSON.stringify({ actions_count: actionsExecuted, event_id: event.id })]
                );
                applied++;
            } catch (ruleErr) {
                await pool.query(
                    `INSERT INTO rule_execution_log (rule_id, trigger_event, result, error, output)
                     VALUES ($1, $2, 'error', $3, $4)`,
                    [rule.id, event.event_type, ruleErr.message, JSON.stringify({ event_id: event.id })]
                );
            }
        }

        // Mark event as processed
        await pool.query(
            `UPDATE event_queue SET status = 'processed', processed_at = NOW() WHERE id = $1`,
            [event.id]
        );
    } catch (err) {
        log.error('Process rules error', err);
        await pool.query(
            `UPDATE event_queue SET status = 'failed', last_error = $1, attempts = attempts + 1 WHERE id = $2`,
            [err.message, event.id]
        ).catch(() => {});
    }
    return applied;
}

/**
 * Execute a single rule action.
 * Supported types: create_task, send_telegram, create_print_job, escalate, log
 */
async function executeAction(action, payload, event) {
    const type = action.type;

    switch (type) {
        case 'create_task': {
            const title = interpolate(action.title || 'Auto-task', payload);
            const description = interpolate(action.description || '', payload);
            await pool.query(
                `INSERT INTO tasks (title, description, date, priority, assigned_to, created_by, type, category)
                 VALUES ($1, $2, CURRENT_DATE, $3, $4, 'rule_engine', 'auto', $5)`,
                [title, description, action.priority || 'normal', action.assigned_to || null, action.category || 'admin']
            );
            log.info(`Action: created task "${title}"`);
            break;
        }

        case 'send_telegram': {
            const { sendTelegramMessage, getConfiguredChatId } = require('./telegram');
            const message = interpolate(action.template || action.message || '', payload);
            const chatId = action.chat_id || await getConfiguredChatId();
            if (chatId && message) {
                await sendTelegramMessage(chatId, message);
                log.info(`Action: sent Telegram message to ${chatId}`);
            }
            break;
        }

        case 'create_print_job': {
            const templateCode = action.template_code;
            if (!templateCode) break;
            const tpl = await pool.query('SELECT id FROM print_templates WHERE code = $1 AND is_active = true', [templateCode]);
            if (tpl.rows.length > 0) {
                await pool.query(
                    `INSERT INTO print_jobs (template_id, job_type, status, data, printed_by)
                     VALUES ($1, $2, 'queued', $3, 'rule_engine')`,
                    [tpl.rows[0].id, action.job_type || 'print', JSON.stringify(payload)]
                );
                log.info(`Action: created print job for template ${templateCode}`);
            }
            break;
        }

        case 'escalate': {
            const { sendTelegramMessage, getConfiguredChatId } = require('./telegram');
            const chatId = await getConfiguredChatId();
            if (chatId) {
                const severity = action.severity || 'medium';
                const icon = severity === 'high' ? '🔴' : severity === 'critical' ? '🚨' : '⚠️';
                const msg = `${icon} <b>Ескалація</b>\n\nПодія: ${event.event_type}\nСерйозність: ${severity}\n${action.message || ''}`;
                await sendTelegramMessage(chatId, msg);
            }
            break;
        }

        case 'log': {
            const message = interpolate(action.message || '', payload);
            log.info(`Rule log: ${message}`);
            break;
        }

        default:
            log.warn(`Unknown action type: ${type}`);
    }
}

/**
 * Simple template interpolation: replaces {key} with payload values.
 */
function interpolate(template, payload) {
    return template.replace(/\{(\w+)\}/g, (_, key) => {
        return payload[key] !== undefined ? String(payload[key]) : `{${key}}`;
    });
}

/**
 * Retry failed events that haven't exceeded max_attempts.
 * Called by the scheduler every minute.
 */
async function processFailedEvents() {
    try {
        const result = await pool.query(
            `SELECT * FROM event_queue
             WHERE status = 'failed'
               AND attempts < max_attempts
               AND (next_retry_at IS NULL OR next_retry_at <= NOW())
             ORDER BY created_at ASC
             LIMIT 10`
        );

        for (const event of result.rows) {
            // Exponential backoff: 2^attempts minutes
            const backoffMinutes = Math.pow(2, event.attempts);
            await pool.query(
                `UPDATE event_queue SET status = 'pending', next_retry_at = NOW() + INTERVAL '1 minute' * $1 WHERE id = $2`,
                [backoffMinutes, event.id]
            );

            // Re-process
            processEventRules(event).catch(err =>
                log.error(`Retry failed for event ${event.id}: ${err.message}`)
            );
        }

        // Move permanently failed events to dead letter
        const deadResult = await pool.query(
            `DELETE FROM event_queue
             WHERE status = 'failed' AND attempts >= max_attempts
             RETURNING id, event_type, payload, last_error`
        );

        for (const dead of deadResult.rows) {
            await pool.query(
                `INSERT INTO event_dead_letter (original_event_id, event_type, payload, error)
                 VALUES ($1, $2, $3, $4)`,
                [dead.id, dead.event_type, dead.payload, dead.last_error]
            );
            log.warn(`Event ${dead.id} moved to dead letter: ${dead.event_type}`);
        }

        if (result.rows.length > 0 || deadResult.rows.length > 0) {
            log.info(`Event queue: ${result.rows.length} retried, ${deadResult.rows.length} moved to DLQ`);
        }
    } catch (err) {
        if (!err.message.includes('does not exist')) {
            log.error('processFailedEvents error', err);
        }
    }
}

module.exports = { publish, processEventRules, processFailedEvents };

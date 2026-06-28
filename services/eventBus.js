/**
 * services/eventBus.js — Universal Event Publisher (v38.4.0)
 *
 * Bridge between application modules and the Event Queue.
 * Any module can publish events; the Rule Engine processes them.
 *
 * v38.4.0: Added transactional outbox support — publishInTransaction()
 *   allows writing events in the same DB transaction as business data,
 *   preventing dual-write issues.
 *
 * Usage:
 *   const { publish, publishInTransaction } = require('../services/eventBus');
 *
 *   // Simple (existing behavior):
 *   await publish('booking.created', { booking_id: 'BK-2026-0001', room: 'VIP' });
 *
 *   // Transactional outbox (new, for critical paths):
 *   const client = await pool.connect();
 *   try {
 *       await client.query('BEGIN');
 *       await client.query('INSERT INTO bookings ...');
 *       await publishInTransaction(client, 'booking.created', { booking_id: 'BK-2026-0001' }, 'booking', 'BK-2026-0001');
 *       await client.query('COMMIT');
 *   } catch (e) { await client.query('ROLLBACK'); throw e; }
 *   finally { client.release(); }
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
        let internalResult = null;
        const internalApplied = await processInternalEventHandler(event);
        if (internalApplied) {
            applied++;
            internalResult = typeof internalApplied === 'object'
                ? internalApplied
                : { outcome: 'processed' };
        }

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
            `UPDATE event_queue
             SET status = 'processed',
                 processed_at = NOW(),
                 convergence_status = COALESCE($2, convergence_status, 'processed'),
                 failure_class = NULL,
                 terminal_at = NULL,
                 last_error = NULL,
                 last_convergence_at = NOW()
             WHERE id = $1`,
            [event.id, internalResult?.outcome || 'processed']
        );
    } catch (err) {
        log.error('Process rules error', err);
        const classification = classifyEventProcessingError(event, err);
        const status = classification.terminal ? 'terminal_failed' : 'failed';
        const convergenceStatus = classification.terminal ? 'terminal_failed' : 'retryable_failed';
        await pool.query(
            `UPDATE event_queue
             SET status = $1,
                 convergence_status = $2,
                 failure_class = $3,
                 last_error = $4,
                 attempts = attempts + 1,
                 terminal_at = CASE WHEN $5 THEN NOW() ELSE terminal_at END,
                 last_convergence_at = NOW()
             WHERE id = $6`,
            [
                status,
                convergenceStatus,
                classification.failureClass,
                classification.message,
                classification.terminal,
                event.id
            ]
        ).catch(() => {});
    }
    return applied;
}

async function processInternalEventHandler(event) {
    if (!event?.event_type || !event.event_type.startsWith('guardian.')) return false;
    const { processGuardianDeliveryEvent } = require('./guardianDelivery');
    return processGuardianDeliveryEvent(event);
}

function classifyEventProcessingError(event, err) {
    if (event?.event_type?.startsWith('guardian.')) {
        const { classifyGuardianDeliveryError } = require('./guardianDelivery');
        return classifyGuardianDeliveryError(err);
    }
    return {
        retryable: true,
        terminal: false,
        failureClass: 'rule_processing_failed',
        message: err?.message || 'Event processing failed'
    };
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
            const bookingSourceId = payload?.booking_id || payload?.bookingId || null;
            const { createTask } = require('./kleshnya');
            const task = await createTask({
                title,
                description,
                date: new Date().toISOString().slice(0, 10),
                priority: action.priority || 'normal',
                assigned_to: action.assigned_to || null,
                created_by: 'rule_engine',
                category: action.category || 'admin',
                source_type: bookingSourceId ? 'booking' : 'manual',
                source_id: bookingSourceId ? String(bookingSourceId) : null,
                duplicateMode: 'skip'
            });
            if (task?.duplicateSkipped) {
                log.info(`Action: skip duplicate task "${title}" (exists: #${task.id})`);
                break;
            }
            log.info(`Action: created task "${title}"`);
            break;
        }

        case 'send_telegram': {
            const { sendTelegramMessage, getConfiguredChatId } = require('./telegram');
            const message = interpolate(action.template || action.message || '', payload);
            const usesCustomerChat = action.use_customer_chat === true;
            const customerChatId = usesCustomerChat ? customerTelegramChatIdFromPayload(payload) : null;
            const chatId = action.chat_id || customerChatId || (!usesCustomerChat ? await getConfiguredChatId() : null);
            if (chatId && message) {
                await sendTelegramMessage(chatId, message);
                log.info(usesCustomerChat ? 'Action: sent Telegram message to customer chat' : `Action: sent Telegram message to ${chatId}`);
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

        case 'chat_message': {
            const channelId = action.channel_id
                || (action.channel_name
                    ? (await pool.query(`SELECT id FROM chat_channels WHERE name ILIKE $1 LIMIT 1`,
                                        [`%${action.channel_name}%`])).rows[0]?.id
                    : null);
            if (!channelId) { log.warn('chat_message: channel not found'); break; }
            const sysRes = await pool.query(`SELECT id FROM users WHERE username = 'system' LIMIT 1`);
            const sysUserId = sysRes.rows[0]?.id;
            if (!sysUserId) { log.warn('chat_message: system user not found'); break; }
            const message = interpolate(action.template || action.message || '', payload);
            if (!message.trim()) break;
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                await client.query('SELECT id FROM chat_channels WHERE id = $1 FOR UPDATE', [channelId]);
                const seqRes = await client.query('SELECT next_chat_seq($1) AS seq', [channelId]);
                const seq    = seqRes.rows[0].seq;
                await client.query(
                    `INSERT INTO chat_messages (channel_id, user_id, seq, content, created_at)
                     VALUES ($1, $2, $3, $4, NOW())`,
                    [channelId, sysUserId, seq, message]
                );
                await client.query('COMMIT');
                log.info(`chat_message: #${channelId} seq=${seq} "${message.slice(0, 50)}"`);
            } catch (e) {
                await client.query('ROLLBACK');
                log.error(`chat_message insert failed: ${e.message}`);
            } finally {
                client.release();
            }
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
    const source = payload?.nps_score !== undefined
        ? String(template).replace(/\{rating\}\/5/g, '{nps_score}/10')
        : String(template);
    return source.replace(/\{(\w+)\}/g, (_, key) => {
        return payload[key] !== undefined ? String(payload[key]) : `{${key}}`;
    });
}

function customerTelegramChatIdFromPayload(payload) {
    const text = String(payload?.telegramChatId || payload?.telegram_chat_id || '').trim();
    return /^[0-9]{5,20}$/.test(text) ? text : null;
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
                `UPDATE event_queue
                 SET status = 'pending',
                     convergence_status = 'retry_scheduled',
                     next_retry_at = NOW() + INTERVAL '1 minute' * $1,
                     last_convergence_at = NOW()
                 WHERE id = $2`,
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
             WHERE status = 'terminal_failed'
                OR (status = 'failed' AND attempts >= max_attempts)
             RETURNING id, event_type, payload, last_error, idempotency_key,
                       attempts, max_attempts, failure_class, status`
        );

        for (const dead of deadResult.rows) {
            const failureClass = dead.failure_class
                || (dead.status === 'failed' ? 'max_attempts_exceeded' : 'terminal_failed');
            await pool.query(
                `INSERT INTO event_dead_letter (
                    original_event_id, event_type, payload, error, idempotency_key,
                    attempts, max_attempts, failure_class, terminal_reason
                 )
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [
                    dead.id,
                    dead.event_type,
                    dead.payload,
                    dead.last_error,
                    dead.idempotency_key,
                    dead.attempts || 0,
                    dead.max_attempts || 0,
                    failureClass,
                    dead.last_error || failureClass
                ]
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

/**
 * v38.4.0: Publish event within an existing DB transaction (outbox pattern).
 * The event is written to outbox_events in the same transaction as business data.
 * A relay worker (processOutbox) will later deliver it to the event queue.
 *
 * @param {import('pg').PoolClient} client - Active DB client with open transaction
 * @param {string} eventType - Event type (e.g., 'booking.created')
 * @param {object} payload - Event payload
 * @param {string} aggregateType - Domain entity type (e.g., 'booking', 'review')
 * @param {string} aggregateId - Entity ID (e.g., 'BK-2026-0001')
 * @param {string} [idempotencyKey] - Optional dedup key
 */
async function publishInTransaction(client, eventType, payload, aggregateType, aggregateId, idempotencyKey) {
    const key = idempotencyKey || `${eventType}_${aggregateId}_${Date.now()}`;
    await client.query(
        `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload, idempotency_key)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [aggregateType, aggregateId, eventType, JSON.stringify(payload || {}), key]
    );
}

/**
 * v38.4.0: Outbox relay — pick unpublished events from outbox, publish to event queue.
 * Should be called by scheduler every few seconds.
 * Uses SELECT ... FOR UPDATE SKIP LOCKED for safe concurrent processing.
 */
async function processOutbox() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const result = await client.query(
            `SELECT id, event_type, payload, idempotency_key, aggregate_type, aggregate_id
             FROM outbox_events
             WHERE published_at IS NULL AND publish_attempts < 5
             ORDER BY occurred_at ASC
             LIMIT 20
             FOR UPDATE SKIP LOCKED`
        );

        if (result.rows.length === 0) {
            await client.query('COMMIT');
            return 0;
        }

        let published = 0;
        const eventsToProcess = [];
        for (const row of result.rows) {
            try {
                // Publish to event_queue (the actual event store)
                const eqResult = await client.query(
                    `INSERT INTO event_queue (event_type, payload, idempotency_key)
                     VALUES ($1, $2, $3)
                     ON CONFLICT (idempotency_key) DO NOTHING
                     RETURNING id`,
                    [row.event_type, row.payload, row.idempotency_key]
                );

                // Mark as published
                await client.query(
                    'UPDATE outbox_events SET published_at = NOW() WHERE id = $1',
                    [row.id]
                );

                if (eqResult.rows.length > 0) {
                    eventsToProcess.push({
                        id: eqResult.rows[0].id,
                        event_type: row.event_type,
                        payload: row.payload,
                        idempotency_key: row.idempotency_key
                    });
                }

                published++;
            } catch (err) {
                await client.query(
                    'UPDATE outbox_events SET publish_attempts = publish_attempts + 1, last_error = $1 WHERE id = $2',
                    [err.message.slice(0, 500), row.id]
                );
                log.error(`Outbox relay failed for event ${row.id}: ${err.message}`);
            }
        }

        await client.query('COMMIT');
        for (const event of eventsToProcess) {
            setImmediate(() => {
                processEventRules(event).catch(err =>
                    log.error(`Outbox rule processing failed for event ${event.id}: ${err.message}`)
                );
            });
        }
        if (published > 0) {
            log.info(`Outbox relay: ${published}/${result.rows.length} events published`);
        }
        return published;
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('processOutbox error', err);
        return 0;
    } finally {
        client.release();
    }
}

/**
 * v38.4.0: Cleanup old published outbox events (retention: 7 days)
 */
async function cleanupOutbox() {
    try {
        const result = await pool.query(
            `DELETE FROM outbox_events
             WHERE published_at IS NOT NULL AND published_at < NOW() - INTERVAL '7 days'
             RETURNING id`
        );
        if (result.rowCount > 0) {
            log.info(`Outbox cleanup: ${result.rowCount} old events removed`);
        }
        return result.rowCount;
    } catch (err) {
        if (!err.message.includes('does not exist')) {
            log.error('cleanupOutbox error', err);
        }
        return 0;
    }
}

module.exports = { publish, publishInTransaction, processEventRules, processFailedEvents, processOutbox, cleanupOutbox };

/**
 * services/bookingAutomation.js — Event-driven booking automation engine
 * v8.3: Creates tasks and sends Telegram messages based on automation rules
 * v12.6: Added notify_contractor action type with confirmation buttons
 *
 * Architecture: Observer pattern — when a booking is created, the engine
 * checks all active rules and executes matching actions.
 *
 * Principle: "Don't hardcode business logic" — rules stored in DB,
 * engine only knows HOW to execute actions, not WHAT to execute.
 */
const { pool } = require('../db');
const { sendTelegramMessage, getConfiguredChatId, telegramRequest } = require('./telegram');
const { createLogger } = require('../utils/logger');

const log = createLogger('Automation');

/**
 * Replace placeholders in template strings with booking data.
 * Placeholders: {date}, {time}, {programName}, {pinataFiller}, {kidsCount},
 *               {room}, {groupName}, {createdBy}, {label}, {notes}, {tshirtSizes}
 */
function interpolate(template, booking) {
    if (!template) return '';

    // v8.3.1: Build t-shirt sizes string from extra_data
    const extraData = booking.extraData || booking.extra_data;
    let tshirtStr = '';
    if (extraData?.tshirt_sizes && typeof extraData.tshirt_sizes === 'object') {
        tshirtStr = Object.entries(extraData.tshirt_sizes)
            .filter(([, v]) => v > 0)
            .map(([s, v]) => `${s}×${v}`)
            .join(', ') || 'не вказано';
    } else {
        tshirtStr = 'не вказано';
    }

    return template
        .replace(/\{date\}/g, booking.date || '')
        .replace(/\{time\}/g, booking.time || '')
        .replace(/\{programName\}/g, booking.programName || booking.program_name || '')
        .replace(/\{pinataFiller\}/g, booking.pinataFiller || booking.pinata_filler || '')
        .replace(/\{kidsCount\}/g, booking.kidsCount || booking.kids_count || '?')
        .replace(/\{room\}/g, booking.room || '')
        .replace(/\{groupName\}/g, booking.groupName || booking.group_name || '')
        .replace(/\{createdBy\}/g, booking.createdBy || booking.created_by || '')
        .replace(/\{label\}/g, booking.label || '')
        .replace(/\{notes\}/g, booking.notes || '')
        .replace(/\{tshirtSizes\}/g, tshirtStr);
}

/**
 * Calculate the task date based on booking date and days_before offset.
 * If days_before=3 and booking is on 2024-02-15, task date is 2024-02-12.
 */
function calculateTaskDate(bookingDate, daysBefore) {
    if (!daysBefore || daysBefore <= 0) return bookingDate;
    const date = new Date(bookingDate + 'T12:00:00');
    date.setDate(date.getDate() - daysBefore);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * Check if a booking matches the rule's trigger condition.
 * Supports: product_ids (array of product IDs), categories (array of categories)
 */
function matchesCondition(condition, booking) {
    if (!condition) return false;
    const productId = booking.programId || booking.program_id;
    const category = booking.category;

    if (condition.product_ids && Array.isArray(condition.product_ids)) {
        if (condition.product_ids.includes(productId)) return true;
    }
    if (condition.categories && Array.isArray(condition.categories)) {
        if (condition.categories.includes(category)) return true;
    }
    return false;
}

/**
 * Execute a single action for a matched rule.
 * Action types: create_task, telegram_group, notify_contractor
 */
async function executeAction(action, booking, rule) {
    switch (action.type) {
        case 'create_task':
            return executeCreateTask(action, booking, rule);
        case 'telegram_group':
            return executeTelegramGroup(action, booking);
        case 'notify_contractor':
            return executeNotifyContractor(action, booking, rule);
        default:
            log.warn(`Unknown action type: ${action.type}`);
    }
}

/**
 * Action: create_task — insert a task into the tasks table
 */
async function executeCreateTask(action, booking, rule) {
    const title = interpolate(action.title, booking);
    const taskDate = calculateTaskDate(booking.date, rule.days_before);
    const bookingId = booking.id || null;

    await pool.query(
        `INSERT INTO tasks (title, date, status, priority, category, created_by, type)
         VALUES ($1, $2, 'todo', $3, $4, $5, 'auto_complete')`,
        [title, taskDate, action.priority || 'normal', action.category || 'purchase',
         booking.createdBy || booking.created_by || 'system']
    );
    log.info(`Auto-task created: "${title}" for ${taskDate} (rule: ${rule.name})`);
}

/**
 * Action: telegram_group — send a message to the configured Telegram group
 */
async function executeTelegramGroup(action, booking) {
    const text = interpolate(action.template, booking);
    const chatId = await getConfiguredChatId();
    if (!chatId) {
        log.warn('No Telegram chat configured, skipping group message');
        return;
    }
    const result = await sendTelegramMessage(chatId, text, { parse_mode: 'HTML' });
    if (result && result.ok) {
        log.info(`Auto-telegram sent for booking ${booking.id}`);
    }
}

/**
 * Action: notify_contractor — send a personal Telegram message to a contractor
 * with inline confirmation buttons (Прийнято / Відхилено)
 */
async function executeNotifyContractor(action, booking, rule) {
    const contractorId = action.contractor_id;
    if (!contractorId) {
        log.warn(`notify_contractor action has no contractor_id (rule: ${rule.name})`);
        return;
    }

    const contractorResult = await pool.query(
        'SELECT * FROM contractors WHERE id = $1 AND is_active = true',
        [contractorId]
    );

    if (contractorResult.rows.length === 0) {
        log.warn(`Contractor ${contractorId} not found or inactive (rule: ${rule.name})`);
        return;
    }

    const contractor = contractorResult.rows[0];
    if (!contractor.telegram_chat_id) {
        log.warn(`Contractor "${contractor.name}" has no Telegram chat_id (rule: ${rule.name})`);
        return;
    }

    const text = interpolate(action.template, booking);

    // Send message with inline confirmation buttons
    const payload = {
        chat_id: contractor.telegram_chat_id,
        text: text,
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [[
                { text: '✅ Прийнято', callback_data: `ctr_accept:${booking.id}:${contractorId}` },
                { text: '❌ Відхилено', callback_data: `ctr_reject:${booking.id}:${contractorId}` }
            ]]
        }
    };

    const result = await telegramRequest('sendMessage', payload);

    if (result && result.ok) {
        // Log notification
        await pool.query(
            `INSERT INTO contractor_notifications (contractor_id, booking_id, rule_id, message_id, status)
             VALUES ($1, $2, $3, $4, 'sent')`,
            [contractorId, booking.id, rule.id, result.result?.message_id || null]
        );
        log.info(`Contractor "${contractor.name}" notified for booking ${booking.id} (rule: ${rule.name})`);
    } else {
        log.warn(`Failed to notify contractor "${contractor.name}" for booking ${booking.id}`);
    }
}

/**
 * Handle contractor callback response (accept/reject)
 * Called from webhook handler when contractor presses inline button
 */
async function handleContractorCallback(action, bookingId, contractorId, callbackQueryId, chatId, messageId) {
    try {
        const status = action === 'ctr_accept' ? 'accepted' : 'rejected';
        const statusText = action === 'ctr_accept' ? '✅ Прийнято' : '❌ Відхилено';

        // Update notification status
        await pool.query(
            `UPDATE contractor_notifications SET status = $1, responded_at = NOW()
             WHERE contractor_id = $2 AND booking_id = $3 AND status = 'sent'`,
            [status, contractorId, bookingId]
        );

        // Get contractor name
        const contractorResult = await pool.query('SELECT name FROM contractors WHERE id = $1', [contractorId]);
        const contractorName = contractorResult.rows[0]?.name || 'Підрядник';

        // Answer callback
        await telegramRequest('answerCallbackQuery', {
            callback_query_id: callbackQueryId,
            text: statusText
        });

        // Edit message to remove buttons and show response
        if (messageId && chatId) {
            // Get original message text
            // Since we can't get the original text from Telegram, we edit with status suffix
            await telegramRequest('editMessageReplyMarkup', {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: { inline_keyboard: [[
                    { text: statusText, callback_data: 'noop' }
                ]] }
            });
        }

        // Notify admin group about contractor response
        const groupChatId = await getConfiguredChatId();
        if (groupChatId) {
            const notifText = action === 'ctr_accept'
                ? `✅ <b>Підрядник ${contractorName}</b> прийняв замовлення для бронювання ${bookingId}`
                : `❌ <b>Підрядник ${contractorName}</b> відхилив замовлення для бронювання ${bookingId}`;
            await sendTelegramMessage(groupChatId, notifText, { parse_mode: 'HTML' });
        }

        // Log to history
        await pool.query(
            'INSERT INTO history (action, username, data) VALUES ($1, $2, $3)',
            ['contractor_response', contractorName,
             JSON.stringify({ contractor_id: contractorId, booking_id: bookingId, status })]
        ).catch(err => log.error('History log error', err));

        log.info(`Contractor ${contractorName} ${status} booking ${bookingId}`);
    } catch (err) {
        log.error('handleContractorCallback error', err);
        await telegramRequest('answerCallbackQuery', {
            callback_query_id: callbackQueryId,
            text: 'Помилка обробки відповіді',
            show_alert: true
        }).catch(() => {});
    }
}

/**
 * Main entry point: process all automation rules for a new booking.
 * Called after booking INSERT + COMMIT (fire-and-forget pattern).
 */
async function processBookingAutomation(booking) {
    if (!booking || !booking.date) return;

    // v12.6: Skip automation if skip_notification flag is set
    if (booking.skipNotification || booking.skip_notification) {
        log.info(`Automation skipped for booking ${booking.id} (skip_notification=true)`);
        return;
    }

    try {
        const rules = await pool.query(
            'SELECT * FROM automation_rules WHERE is_active = true'
        );

        let triggered = 0;
        const event = booking._event || 'create';
        for (const rule of rules.rows) {
            // Filter by trigger_type vs event
            if (rule.trigger_type === 'booking_create' && event !== 'create') continue;
            if (rule.trigger_type === 'booking_confirm' && event !== 'confirm') continue;

            if (matchesCondition(rule.trigger_condition, booking)) {
                const actions = Array.isArray(rule.actions) ? rule.actions : [];
                for (const action of actions) {
                    try {
                        await executeAction(action, booking, rule);
                    } catch (actionErr) {
                        log.error(`Action failed (rule: ${rule.name}, type: ${action.type})`, actionErr);
                    }
                }
                triggered++;

                // Log to history
                await pool.query(
                    'INSERT INTO history (action, username, data) VALUES ($1, $2, $3)',
                    ['automation_triggered', booking.createdBy || booking.created_by || 'system',
                     JSON.stringify({ rule_id: rule.id, rule_name: rule.name, booking_id: booking.id })]
                ).catch(err => log.error('History log error', err));
            }
        }

        if (triggered > 0) {
            log.info(`Automation: ${triggered} rule(s) triggered for booking ${booking.id}`);
        }
    } catch (err) {
        // Non-blocking: automation errors should never break booking creation
        log.error('Automation processing error (non-blocking)', err);
    }
}

module.exports = { processBookingAutomation, handleContractorCallback, interpolate, matchesCondition };

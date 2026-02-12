/**
 * services/bookingAutomation.js — Event-driven booking automation engine
 * v8.3: Creates tasks and sends Telegram messages based on automation rules
 *
 * Architecture: Observer pattern — when a booking is created, the engine
 * checks all active rules and executes matching actions.
 *
 * Principle: "Don't hardcode business logic" — rules stored in DB,
 * engine only knows HOW to execute actions, not WHAT to execute.
 */
const { pool } = require('../db');
const { sendTelegramMessage, getConfiguredChatId } = require('./telegram');
const { createLogger } = require('../utils/logger');

const log = createLogger('Automation');

/**
 * Replace placeholders in template strings with booking data.
 * Placeholders: {date}, {time}, {programName}, {pinataFiller}, {kidsCount},
 *               {room}, {groupName}, {createdBy}, {label}, {notes}
 */
function interpolate(template, booking) {
    if (!template) return '';
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
        .replace(/\{notes\}/g, booking.notes || '');
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
 * Action types: create_task, telegram_group
 */
async function executeAction(action, booking, rule) {
    switch (action.type) {
        case 'create_task':
            return executeCreateTask(action, booking, rule);
        case 'telegram_group':
            return executeTelegramGroup(action, booking);
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
 * Main entry point: process all automation rules for a new booking.
 * Called after booking INSERT + COMMIT (fire-and-forget pattern).
 */
async function processBookingAutomation(booking) {
    try {
        const rules = await pool.query(
            'SELECT * FROM automation_rules WHERE is_active = true'
        );

        let triggered = 0;
        for (const rule of rules.rows) {
            // Filter by trigger_type
            if (rule.trigger_type === 'booking_confirm' && booking.status === 'preliminary') continue;

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

module.exports = { processBookingAutomation, interpolate, matchesCondition };

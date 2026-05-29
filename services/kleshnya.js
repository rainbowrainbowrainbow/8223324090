/**
 * services/kleshnya.js — Помічник: центральний процесор Tasker (v10.0)
 *
 * Помічник:
 *  - створює задачі (від подій, тригерів, вручну)
 *  - контролює виконання (дедлайни, залежності)
 *  - ескалює прострочені задачі (4 рівні)
 *  - нараховує бали за виконання
 *  - надсилає нагадування через Telegram
 *  - веде журнал змін (task_logs)
 *
 * Типи задач:
 *  - HUMAN: 100% відповідальність людини
 *  - BOT: 100% системне виконання
 */
const { pool } = require('../db');
const { sendTelegramMessage, getConfiguredChatId, getConfiguredThreadId, telegramRequest } = require('./telegram');
const { createLogger } = require('../utils/logger');
const { TaskDuplicateError, findActiveDuplicateTask } = require('./taskDuplicatePolicy');
const {
    DEFAULT_TASK_BUSINESS_CONTEXT,
    taskBusinessContextFromPayload
} = require('./taskBusinessScope');

const log = createLogger('Kleshnya');

// --- Escalation messages (4 levels) ---
const ESCALATION_MESSAGES = [
    // Level 0 — soft reminder
    (task) => `📋 Нагадую: задача "<b>${esc(task.title)}</b>" очікує виконання.${task.deadline ? `\n⏰ Дедлайн: ${formatDeadline(task.deadline)}` : ''}`,
    // Level 1 — firmer
    (task) => `⚠️ Задача "<b>${esc(task.title)}</b>" все ще не виконана.\nБудь ласка, оновіть статус.${task.deadline ? `\n⏰ Дедлайн: ${formatDeadline(task.deadline)}` : ''}`,
    // Level 2 — urgent
    (task) => `🔴 Задача "<b>${esc(task.title)}</b>" прострочена!\nПотрібна увага.${task.deadline ? `\n⏰ Дедлайн був: ${formatDeadline(task.deadline)}` : ''}`,
    // Level 3 — director escalation
    (task) => `🚨 <b>Ескалація:</b> задача "<b>${esc(task.title)}</b>" не виконана.\n👤 Відповідальний: ${task.owner || task.assigned_to || '—'}\n⏰ Дедлайн: ${task.deadline ? formatDeadline(task.deadline) : '—'}\nПотрібне рішення.`
];

// --- Points rules ---
const POINTS = {
    ON_TIME:          { monthly: 5,  permanent: 2,  reason: 'Виконано вчасно' },
    EARLY:            { monthly: 7,  permanent: 3,  reason: 'Виконано із запасом часу' },
    LATE_MINOR:       { monthly: -2, permanent: 0,  reason: 'Прострочено < 1 год' },
    LATE_MAJOR:       { monthly: -5, permanent: -1, reason: 'Прострочено > 1 год' },
    NO_STATUS_UPDATE: { monthly: -3, permanent: 0,  reason: 'Не оновлено статус' },
    HIGH_PRIORITY:    { monthly: 10, permanent: 5,  reason: 'High priority вчасно' }
};

// --- Helpers ---
function esc(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatDeadline(deadline) {
    const d = new Date(deadline);
    return d.toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function getCurrentMonth() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

async function resolveTaskOwnerSnapshot({ assigned_to, owner, owner_user_id, created_by_user_id, created_by }) {
    const explicitId = Number(owner_user_id || 0);
    const initial = {
        assigned_to: assigned_to || null,
        owner: owner || null,
        owner_user_id: Number.isInteger(explicitId) && explicitId > 0 ? explicitId : null
    };
    const createdById = Number(created_by_user_id || 0);
    const lookupText = String(assigned_to || owner || created_by || '').trim();
    const systemActors = new Set(['system', 'kleshnya', 'rule_engine', 'scheduler', 'graduation-ops', 'svitlana-bot']);

    try {
        let result = null;
        if (Number.isInteger(explicitId) && explicitId > 0) {
            result = await pool.query(
                `SELECT id, username, name
                 FROM users
                 WHERE id = $1 AND COALESCE(is_active, true) = true
                 LIMIT 1`,
                [explicitId]
            );
        } else if (lookupText && !systemActors.has(lookupText.toLowerCase())) {
            result = await pool.query(
                `SELECT id, username, name
                 FROM users
                 WHERE COALESCE(is_active, true) = true
                   AND (LOWER(username) = LOWER($1) OR LOWER(COALESCE(name, '')) = LOWER($1))
                 ORDER BY id
                 LIMIT 1`,
                [lookupText]
            );
        } else if (Number.isInteger(createdById) && createdById > 0) {
            result = await pool.query(
                `SELECT id, username, name
                 FROM users
                 WHERE id = $1 AND COALESCE(is_active, true) = true
                 LIMIT 1`,
                [createdById]
            );
        }

        const user = result?.rows?.[0];
        if (!user) return initial;
        const label = user.name || user.username || `User #${user.id}`;
        return {
            assigned_to: initial.assigned_to || label,
            owner: initial.owner || label,
            owner_user_id: user.id
        };
    } catch (err) {
        log.warn(`Task owner resolution skipped: ${err.message}`);
        return initial;
    }
}

// --- Core functions ---

/**
 * Create a task through Kleshnya (with logging + notification)
 */
async function createTask(data) {
    const {
        business_context,
        businessContext,
        title, description, date, priority = 'normal', assigned_to, owner, owner_user_id,
        task_type = 'human', deadline, time_window_start, time_window_end,
        dependency_ids = [], control_policy, source_type = 'manual', source_id,
        category = 'admin', subcategory = null, checklist_template_key = null,
        source_entity_type = null, source_entity_id = null, pack_id = null,
        pack_status = null, owner_role = null, sla_minutes = null, escalate_after = null,
        template_id, afisha_id, created_by = 'kleshnya', created_by_user_id = null,
        type = null,
        task_mode = 'work', task_kind = 'action', visibility = 'team', workflow_state = 'todo',
        remind_at = null, snoozed_until = null, last_notified_at = null, next_notification_at = null,
        evening_review_date = null, focus_rank = 0, related_entity_type = null, related_entity_id = null,
        source_module = null, effort_minutes = null,
        control_meta = null,
        forceDuplicate = false, duplicateMode = 'skip'
    } = data;

    if (!title || !title.trim()) throw new Error('title required');
    const taskBusinessContext = taskBusinessContextFromPayload(
        { business_context, businessContext },
        DEFAULT_TASK_BUSINESS_CONTEXT
    );

    const ownerSnapshot = await resolveTaskOwnerSnapshot({
        assigned_to,
        owner,
        owner_user_id,
        created_by_user_id,
        created_by
    });
    const policy = control_policy || { reminder_minutes: [60, 30, 10], escalation_after_minutes: 120 };
    const duplicate = await findActiveDuplicateTask(pool, {
        title,
        date,
        deadline,
        remind_at,
        owner_user_id: ownerSnapshot.owner_user_id,
        category,
        subcategory,
        source_type,
        source_id,
        template_id,
        source_entity_type,
        source_entity_id,
        pack_id,
        checklist_template_key,
        afisha_id,
        businessContext: taskBusinessContext
    });
    if (duplicate && !forceDuplicate) {
        if (duplicateMode === 'reject') {
            throw new TaskDuplicateError(duplicate, `Задача "${title.trim()}" вже існує`);
        }
        log.info(`Task duplicate skipped: #${duplicate.id} "${title.trim()}" [${source_type}]`);
        return {
            ...duplicate,
            duplicateSkipped: true,
            duplicateOfTaskId: duplicate.id
        };
    }

    const result = await pool.query(
        `INSERT INTO tasks (business_context, title, description, date, priority, assigned_to, owner, owner_user_id, created_by,
         task_type, deadline, time_window_start, time_window_end, dependency_ids,
         control_policy, source_type, source_id, category, subcategory, checklist_template_key,
         source_entity_type, source_entity_id, pack_id, pack_status, owner_role, sla_minutes, escalate_after,
         template_id, afisha_id, type,
         task_mode, task_kind, visibility, workflow_state, remind_at, snoozed_until,
         last_notified_at, next_notification_at, evening_review_date, focus_rank,
          related_entity_type, related_entity_id, source_module, effort_minutes, control_meta, created_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
                 $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,
                 $39,$40,$41,$42,$43,$44,$45,$46) RETURNING *`,
        [taskBusinessContext, title.trim(), description || null, date || null, priority, ownerSnapshot.assigned_to, ownerSnapshot.owner,
         ownerSnapshot.owner_user_id, created_by, task_type, deadline || null, time_window_start || null, time_window_end || null,
         dependency_ids, JSON.stringify(policy), source_type, source_id || null,
         category, subcategory || null, checklist_template_key || null,
         source_entity_type || null, source_entity_id || null, pack_id || null, pack_status || null,
         owner_role || null, sla_minutes || null, escalate_after || null,
         template_id || null, afisha_id || null,
         type || (source_type === 'recurring' ? 'recurring' : (source_type === 'afisha' ? 'afisha' : (source_type === 'booking' ? 'auto_complete' : 'manual'))),
         task_mode, task_kind, visibility, workflow_state, remind_at, snoozed_until,
         last_notified_at, next_notification_at, evening_review_date, focus_rank,
         related_entity_type, related_entity_id, source_module, effort_minutes, JSON.stringify(control_meta || {}), created_by_user_id || null]
    );

    const task = result.rows[0];

    // Log creation
    await logTaskAction(task.id, 'created', null, title, created_by);

    // Notify assigned person (fire-and-forget — never block task creation)
    if (task.assigned_to && task_type === 'human') {
        notifyTaskAssigned(task).catch(err => log.error(`Task notification error: ${err.message}`));
    }

    log.info(`Task created: #${task.id} "${title}" [${task_type}] assigned=${task.assigned_to || '—'} owner=${task.owner || '—'}`);
    return task;
}

/**
 * Update task status (with logging, points, notification)
 */
async function updateTaskStatus(taskId, newStatus, actor = 'system') {
    const taskResult = await pool.query('SELECT * FROM tasks WHERE id = $1', [taskId]);
    if (taskResult.rows.length === 0) throw new Error('Task not found');

    const task = taskResult.rows[0];
    const oldStatus = task.status;

    if (oldStatus === newStatus) return task;

    const currentVersion = task.version || 1;
    const updateResult = await pool.query(
        `UPDATE tasks
         SET status=$1,
             workflow_state=CASE WHEN $4='done' THEN 'done' WHEN $4='in_progress' THEN 'in_progress' ELSE COALESCE(NULLIF(workflow_state, 'done'), 'todo') END,
             schedule_status=CASE WHEN $4='done' AND scheduled_start_at IS NOT NULL THEN 'completed' ELSE schedule_status END,
             updated_at=NOW(),
             completed_at=CASE WHEN $4='done' THEN NOW() ELSE NULL END,
             archived_at=NULL,
             archive_reason=NULL,
             duplicate_of_task_id=NULL,
             escalation_level=0,
             version=version+1
         WHERE id=$2 AND version=$3`,
        [newStatus, taskId, currentVersion, newStatus]
    );

    if (updateResult.rowCount === 0) {
        throw new Error('Conflict: task was modified by another user');
    }

    // Log status change
    await logTaskAction(taskId, 'status_changed', oldStatus, newStatus, actor);

    // Award points on completion
    if (newStatus === 'done' && task.task_type === 'human') {
        const assignee = task.assigned_to || task.owner;
        if (assignee) {
            await evaluateAndAwardPoints(task, assignee);
        }
    }

    // Notify about status change (fire-and-forget — never block status update)
    notifyTaskStatusChanged(task, oldStatus, newStatus, actor).catch(err => log.error(`Status notification error: ${err.message}`));

    log.info(`Task #${taskId} status: ${oldStatus} → ${newStatus} by ${actor}`);

    const updated = await pool.query('SELECT * FROM tasks WHERE id = $1', [taskId]);
    return updated.rows[0];
}

/**
 * Check task dependencies — are all blocking tasks done?
 */
async function checkDependencies(taskId) {
    const taskResult = await pool.query('SELECT dependency_ids FROM tasks WHERE id = $1', [taskId]);
    if (taskResult.rows.length === 0) return false;

    const deps = taskResult.rows[0].dependency_ids;
    if (!deps || deps.length === 0) return true; // no dependencies — unblocked

    const result = await pool.query(
        `SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'done') as done FROM tasks WHERE id = ANY($1)`,
        [deps]
    );

    return parseInt(result.rows[0].total) === parseInt(result.rows[0].done);
}

/**
 * Escalate a task to the next level
 */
async function escalateTask(taskId) {
    const taskResult = await pool.query('SELECT * FROM tasks WHERE id = $1', [taskId]);
    if (taskResult.rows.length === 0) return;

    const task = taskResult.rows[0];
    const newLevel = Math.min((task.escalation_level || 0) + 1, 3);

    await pool.query(
        'UPDATE tasks SET escalation_level = $1, last_reminded_at = NOW(), updated_at = NOW() WHERE id = $2',
        [newLevel, taskId]
    );

    await logTaskAction(taskId, 'escalated', String(task.escalation_level), String(newLevel), 'kleshnya');

    // Send escalation message
    const msgFn = ESCALATION_MESSAGES[newLevel] || ESCALATION_MESSAGES[0];
    const text = msgFn(task);

    // Level 3 — send to director
    if (newLevel >= 3) {
        await sendToDirector(text);
    }

    // Send to group with @mention
    await sendTaskNotification(text, task);

    // Deduct points for overdue
    if (newLevel >= 2 && task.assigned_to) {
        const penalty = newLevel >= 2 ? POINTS.LATE_MAJOR : POINTS.LATE_MINOR;
        await awardPoints(task.assigned_to, penalty.monthly, 'monthly', penalty.reason, taskId);
        if (penalty.permanent !== 0) {
            await awardPoints(task.assigned_to, penalty.permanent, 'permanent', penalty.reason, taskId);
        }
    }

    log.info(`Task #${taskId} escalated to level ${newLevel}`);
}

/**
 * Send a reminder for a task
 */
async function sendReminder(taskId) {
    const taskResult = await pool.query('SELECT * FROM tasks WHERE id = $1', [taskId]);
    if (taskResult.rows.length === 0) return;

    const task = taskResult.rows[0];
    const level = task.escalation_level || 0;
    const msgFn = ESCALATION_MESSAGES[level] || ESCALATION_MESSAGES[0];
    const text = msgFn(task);

    await pool.query('UPDATE tasks SET last_reminded_at = NOW() WHERE id = $1', [taskId]);
    await logTaskAction(taskId, 'reminded', null, `level ${level}`, 'kleshnya');
    await sendTaskNotification(text, task);

    log.info(`Reminder sent for task #${taskId} (level ${level})`);
}

/**
 * Evaluate task completion and award points
 */
async function evaluateAndAwardPoints(task, username) {
    if (!task.deadline) {
        // No deadline — standard points
        await awardPoints(username, POINTS.ON_TIME.monthly, 'monthly', POINTS.ON_TIME.reason, task.id);
        await awardPoints(username, POINTS.ON_TIME.permanent, 'permanent', POINTS.ON_TIME.reason, task.id);

        if (task.priority === 'high') {
            await awardPoints(username, POINTS.HIGH_PRIORITY.monthly, 'monthly', POINTS.HIGH_PRIORITY.reason, task.id);
            await awardPoints(username, POINTS.HIGH_PRIORITY.permanent, 'permanent', POINTS.HIGH_PRIORITY.reason, task.id);
        }
        return;
    }

    const now = new Date();
    const deadline = new Date(task.deadline);
    const diffMs = deadline - now;
    const diffMinutes = diffMs / (1000 * 60);

    if (diffMinutes > 60) {
        // Completed with more than 1h to spare — early bonus
        await awardPoints(username, POINTS.EARLY.monthly, 'monthly', POINTS.EARLY.reason, task.id);
        await awardPoints(username, POINTS.EARLY.permanent, 'permanent', POINTS.EARLY.reason, task.id);
    } else if (diffMinutes >= 0) {
        // On time
        await awardPoints(username, POINTS.ON_TIME.monthly, 'monthly', POINTS.ON_TIME.reason, task.id);
        await awardPoints(username, POINTS.ON_TIME.permanent, 'permanent', POINTS.ON_TIME.reason, task.id);
    } else if (diffMinutes > -60) {
        // Late by less than 1 hour
        await awardPoints(username, POINTS.LATE_MINOR.monthly, 'monthly', POINTS.LATE_MINOR.reason, task.id);
    } else {
        // Late by more than 1 hour
        await awardPoints(username, POINTS.LATE_MAJOR.monthly, 'monthly', POINTS.LATE_MAJOR.reason, task.id);
        await awardPoints(username, POINTS.LATE_MAJOR.permanent, 'permanent', POINTS.LATE_MAJOR.reason, task.id);
    }

    // High priority bonus (only if on time)
    if (task.priority === 'high' && diffMinutes >= 0) {
        await awardPoints(username, POINTS.HIGH_PRIORITY.monthly, 'monthly', POINTS.HIGH_PRIORITY.reason, task.id);
        await awardPoints(username, POINTS.HIGH_PRIORITY.permanent, 'permanent', POINTS.HIGH_PRIORITY.reason, task.id);
    }
}

/**
 * Award points to a user
 */
async function awardPoints(username, points, type, reason, taskId = null) {
    if (points === 0) return;

    const month = getCurrentMonth();

    // Upsert user_points
    if (type === 'monthly') {
        await pool.query(
            `INSERT INTO user_points (username, monthly_points, month, updated_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (username, month) DO UPDATE SET monthly_points = user_points.monthly_points + $2, updated_at = NOW()`,
            [username, points, month]
        );
    } else {
        await pool.query(
            `INSERT INTO user_points (username, permanent_points, month, updated_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (username, month) DO UPDATE SET permanent_points = user_points.permanent_points + $2, updated_at = NOW()`,
            [username, points, month]
        );
    }

    // Record transaction
    await pool.query(
        'INSERT INTO point_transactions (username, points, type, reason, task_id) VALUES ($1,$2,$3,$4,$5)',
        [username, points, type, reason, taskId]
    );

    log.info(`Points: ${username} ${points > 0 ? '+' : ''}${points} ${type} — ${reason}`);
}

/**
 * Log a task action
 */
async function logTaskAction(taskId, action, oldValue, newValue, actor = 'system') {
    try {
        await pool.query(
            'INSERT INTO task_logs (task_id, action, old_value, new_value, actor) VALUES ($1,$2,$3,$4,$5)',
            [taskId, action, oldValue || null, newValue || null, actor]
        );
    } catch (err) {
        log.error(`Task log error: ${err.message}`);
    }
}

// --- Telegram notification helpers ---

/**
 * Send task notification to configured chat (with @mention and inline buttons)
 */
async function sendTaskNotification(text, task) {
    const chatId = await getConfiguredChatId();
    if (!chatId) return;

    // Try personal notification first (with inline buttons)
    const personalSent = await sendPersonalNotification(text, task);

    // Always send to group as well (with @mention if no personal chat)
    let groupText = text;
    if (!personalSent && task.assigned_to) {
        const tgUsername = await getTelegramUsername(task.assigned_to);
        if (tgUsername) {
            groupText += `\n\n👤 @${tgUsername}`;
        }
    }

    // v11.1: Add inline action buttons for actionable tasks
    const buttons = getTaskInlineButtons(task);
    if (buttons) {
        const threadId = await getConfiguredThreadId();
        const payload = {
            chat_id: chatId,
            text: groupText,
            parse_mode: 'HTML',
            disable_notification: true,
            reply_markup: { inline_keyboard: buttons }
        };
        if (threadId) payload.message_thread_id = threadId;
        await telegramRequest('sendMessage', payload);
    } else {
        await sendTelegramMessage(chatId, groupText);
    }
}

/**
 * Try to send personal notification to user's Telegram (with inline buttons)
 */
async function sendPersonalNotification(text, task) {
    const assignee = task.assigned_to;
    const ownerUserId = Number(task.owner_user_id || task.ownerUserId || 0);
    if (!assignee && !ownerUserId) return false;

    try {
        const result = ownerUserId
            ? await pool.query(
                'SELECT telegram_chat_id FROM users WHERE id = $1 AND telegram_chat_id IS NOT NULL',
                [ownerUserId]
            )
            : await pool.query(
                'SELECT telegram_chat_id FROM users WHERE username = $1 AND telegram_chat_id IS NOT NULL',
                [assignee]
            );
        if (result.rows.length > 0 && result.rows[0].telegram_chat_id) {
            const personalChatId = String(result.rows[0].telegram_chat_id);
            const buttons = getTaskInlineButtons(task);
            if (buttons) {
                await telegramRequest('sendMessage', {
                    chat_id: personalChatId,
                    text,
                    parse_mode: 'HTML',
                    reply_markup: { inline_keyboard: buttons }
                });
            } else {
                await sendTelegramMessage(personalChatId, text);
            }
            return true;
        }
    } catch (err) {
        log.error(`Personal notification error: ${err.message}`);
    }
    return false;
}

/**
 * v11.1: Build inline keyboard buttons for task actions
 * Returns inline_keyboard array or null if no buttons needed
 */
function getTaskInlineButtons(task) {
    if (!task || !task.id) return null;
    // Only show buttons for open human tasks
    if (task.task_type === 'bot') return null;
    if (task.status === 'done' || task.status === 'cancelled') return null;

    const buttons = [];
    if (task.status === 'todo') {
        buttons.push([
            { text: '🔄 В роботу', callback_data: `task_confirm:${task.id}:todo` },
            { text: '✅ Виконано', callback_data: `task_done:${task.id}:todo` }
        ]);
    } else if (task.status === 'in_progress') {
        buttons.push([
            { text: '✅ Виконано', callback_data: `task_done:${task.id}:in_progress` }
        ]);
    }
    return buttons.length > 0 ? buttons : null;
}

/**
 * Get telegram_username for @mention from users or staff table
 */
async function getTelegramUsername(username) {
    try {
        // Check users table first
        const userResult = await pool.query(
            'SELECT telegram_username FROM users WHERE username = $1 AND telegram_username IS NOT NULL',
            [username]
        );
        if (userResult.rows.length > 0 && userResult.rows[0].telegram_username) {
            return userResult.rows[0].telegram_username;
        }

        // Fallback: check staff by name match
        const staffResult = await pool.query(
            'SELECT telegram_username FROM staff WHERE telegram_username IS NOT NULL AND (name ILIKE $1 OR name ILIKE $2) LIMIT 1',
            [username, `%${username}%`]
        );
        if (staffResult.rows.length > 0) {
            return staffResult.rows[0].telegram_username;
        }
    } catch (err) {
        log.error(`getTelegramUsername error: ${err.message}`);
    }
    return null;
}

/**
 * Notify about new task assignment
 */
async function notifyTaskAssigned(task) {
    const priorityIcon = task.priority === 'high' ? '🔴' : task.priority === 'low' ? '🔵' : '';
    let text = `📌 <b>Нова задача</b>${priorityIcon ? ' ' + priorityIcon : ''}\n\n`;
    text += `📋 ${esc(task.title)}\n`;
    if (task.description) text += `📝 ${esc(task.description)}\n`;
    if (task.date) text += `📅 ${task.date}\n`;
    if (task.deadline) text += `⏰ Дедлайн: ${formatDeadline(task.deadline)}\n`;
    text += `👤 Виконавець: ${task.assigned_to}\n`;
    if (task.owner && task.owner !== task.assigned_to) text += `👔 Відповідальний: ${task.owner}\n`;
    text += `\n🤖 Помічник`;

    await sendTaskNotification(text, task);
}

/**
 * Notify about task status change
 */
async function notifyTaskStatusChanged(task, oldStatus, newStatus, actor) {
    const statusIcons = { todo: '⬜', in_progress: '🔄', done: '✅' };
    const statusNames = { todo: 'Очікує', in_progress: 'В роботі', done: 'Завершено' };

    let text = `⚡ <b>Статус задачі змінено</b>\n\n`;
    text += `📋 ${esc(task.title)}\n`;
    text += `${statusIcons[oldStatus] || '?'} ${statusNames[oldStatus] || oldStatus} → ${statusIcons[newStatus] || '?'} ${statusNames[newStatus] || newStatus}\n`;
    text += `👤 Змінив: ${actor}\n`;
    text += `\n🤖 Помічник`;

    // Only send to group (not personal for status changes)
    const chatId = await getConfiguredChatId();
    if (chatId) {
        await sendTelegramMessage(chatId, text);
    }
}

/**
 * Send escalation to director
 */
async function sendToDirector(text) {
    try {
        const result = await pool.query("SELECT value FROM settings WHERE key = 'cert_director_chat_id'");
        if (result.rows.length > 0 && result.rows[0].value) {
            await sendTelegramMessage(result.rows[0].value, text);
        }
    } catch (err) {
        log.error(`Send to director error: ${err.message}`);
    }
}

/**
 * Register user's Telegram chat_id (called from /start command)
 */
async function registerTelegramChatId(username, chatId) {
    try {
        await pool.query(
            'UPDATE users SET telegram_chat_id = $1 WHERE username = $2',
            [chatId, username]
        );
        log.info(`Telegram chat_id registered: ${username} → ${chatId}`);
        return true;
    } catch (err) {
        log.error(`registerTelegramChatId error: ${err.message}`);
        return false;
    }
}

/**
 * Get tasks that need reminders (called by scheduler)
 * Returns tasks where deadline is approaching or passed
 */
async function getTasksNeedingReminders() {
    try {
        const result = await pool.query(`
            SELECT * FROM tasks
            WHERE status != 'done'
              AND task_type = 'human'
              AND deadline IS NOT NULL
              AND (
                last_reminded_at IS NULL
                OR last_reminded_at < NOW() - INTERVAL '30 minutes'
              )
            ORDER BY deadline ASC
            LIMIT 200
        `);
        return result.rows;
    } catch (err) {
        log.error(`getTasksNeedingReminders error: ${err.message}`);
        return [];
    }
}

/**
 * Get overdue tasks (deadline passed, not done)
 */
async function getOverdueTasks() {
    try {
        const result = await pool.query(`
            SELECT * FROM tasks
            WHERE status != 'done'
              AND deadline IS NOT NULL
              AND deadline < NOW()
            ORDER BY deadline ASC
            LIMIT 200
        `);
        return result.rows;
    } catch (err) {
        log.error(`getOverdueTasks error: ${err.message}`);
        return [];
    }
}

/**
 * Process task reminders — called by scheduler every minute
 */
async function processReminders() {
    const tasks = await getTasksNeedingReminders();
    const now = new Date();

    for (const task of tasks) {
        const deadline = new Date(task.deadline);
        const diffMinutes = (deadline - now) / (1000 * 60);
        const policy = task.control_policy || { reminder_minutes: [60, 30, 10], escalation_after_minutes: 120 };

        if (diffMinutes < 0) {
            // Overdue — escalate
            const overdueMinutes = Math.abs(diffMinutes);
            const escalateAfter = policy.escalation_after_minutes || 120;

            if (overdueMinutes > escalateAfter * (task.escalation_level + 1)) {
                await escalateTask(task.id);
            } else if (!task.last_reminded_at || (now - new Date(task.last_reminded_at)) > 30 * 60 * 1000) {
                await sendReminder(task.id);
            }
        } else {
            // Approaching deadline — check reminder_minutes
            const reminderMinutes = policy.reminder_minutes || [60, 30, 10];
            for (const rm of reminderMinutes) {
                if (diffMinutes <= rm && diffMinutes > rm - 1) {
                    await sendReminder(task.id);
                    break;
                }
            }
        }
    }
}

/**
 * Get user points summary
 */
async function getUserPoints(username) {
    const month = getCurrentMonth();
    try {
        const result = await pool.query(
            'SELECT * FROM user_points WHERE username = $1 AND month = $2',
            [username, month]
        );
        if (result.rows.length === 0) {
            return { username, permanent_points: 0, monthly_points: 0, month };
        }
        return result.rows[0];
    } catch (err) {
        log.error(`getUserPoints error: ${err.message}`);
        return { username, permanent_points: 0, monthly_points: 0, month };
    }
}

/**
 * Get all users' points for leaderboard
 */
async function getAllPoints() {
    const month = getCurrentMonth();
    try {
        const result = await pool.query(
            `SELECT up.username,
                    COALESCE(SUM(up.permanent_points), 0) as permanent_total,
                    COALESCE(MAX(CASE WHEN up.month = $1 THEN up.monthly_points ELSE 0 END), 0) as monthly_current,
                    u.role, u.name
             FROM user_points up
             LEFT JOIN users u ON up.username = u.username
             GROUP BY up.username, u.role, u.name
             ORDER BY permanent_total DESC`,
            [month]
        );
        return result.rows;
    } catch (err) {
        log.error(`getAllPoints error: ${err.message}`);
        return [];
    }
}

/**
 * Reset monthly points (called on 1st of each month)
 */
async function resetMonthlyPoints() {
    const month = getCurrentMonth();
    log.info(`Monthly points reset for ${month}`);
    // Monthly points are per-month rows, so no reset needed — new month = new row
    // But we can log it
    await logTaskAction(0, 'monthly_reset', null, month, 'kleshnya');
}

module.exports = {
    createTask, updateTaskStatus, checkDependencies,
    escalateTask, sendReminder, awardPoints, evaluateAndAwardPoints,
    logTaskAction, processReminders,
    getUserPoints, getAllPoints, resetMonthlyPoints,
    registerTelegramChatId, getOverdueTasks,
    POINTS, ESCALATION_MESSAGES
};

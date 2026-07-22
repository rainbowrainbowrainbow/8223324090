'use strict';

const { createTask } = require('./kleshnya');

const MENU_ACTUAL_TASK_TITLE = 'Закрити меню по факту';
const MENU_ACTUAL_TASK_SOURCE_TYPE = 'booking';
const MENU_ACTUAL_TASK_SOURCE_MODULE = 'banquet_menu_actual';
const KYIV_TIME_ZONE = 'Europe/Kyiv';
const ACTIVE_TASK_STATUS_SQL = "COALESCE(status, 'todo') NOT IN ('done','archived','cancelled')";

function parseObject(value) {
    if (!value) return {};
    if (typeof value === 'object' && !Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function cleanText(value, max = 240) {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    return text ? text.slice(0, max) : null;
}

function money(value, fallback = 0) {
    if (value === undefined || value === null || value === '') return fallback;
    const normalized = typeof value === 'string'
        ? value.replace(/\s+/g, '').replace(',', '.').replace(/[^\d.-]/g, '')
        : value;
    const number = Number(normalized);
    if (!Number.isFinite(number) || number < 0) return fallback;
    return Math.round(number * 100) / 100;
}

function bookingPackageOf(booking = {}) {
    const extra = parseObject(booking.extraData ?? booking.extra_data);
    return booking.bookingPackage
        || booking.booking_package
        || extra.bookingPackage
        || extra.booking_package
        || {};
}

function menuWorkflowOf(booking = {}) {
    const bookingPackage = bookingPackageOf(booking);
    return parseObject(bookingPackage.menuWorkflow || bookingPackage.menu_workflow);
}

function isActualAwaitingBooking(booking = {}) {
    const workflow = menuWorkflowOf(booking);
    return workflow.mode === 'actual' && workflow.status === 'awaiting_actual'
        && String(booking.status || 'confirmed').trim().toLowerCase() !== 'cancelled';
}

function isActualFinalizedBooking(booking = {}) {
    const workflow = menuWorkflowOf(booking);
    return workflow.mode === 'actual' && workflow.status === 'finalized';
}

function kyivParts(date) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: KYIV_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(date).reduce((acc, part) => {
        if (part.type !== 'literal') acc[part.type] = Number(part.value);
        return acc;
    }, {});
}

function kyivOffsetMsAt(utcDate) {
    const parts = kyivParts(utcDate);
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second || 0);
    return asUtc - utcDate.getTime();
}

function kyivWallTimeToUtc(dateText, minutesOfDay) {
    const [year, month, day] = String(dateText || '').split('-').map(Number);
    if (!year || !month || !day) return null;
    const hours = Math.floor(minutesOfDay / 60);
    const minutes = minutesOfDay % 60;
    const wallAsUtc = Date.UTC(year, month - 1, day, hours, minutes, 0);
    const firstGuess = new Date(wallAsUtc);
    let offset = kyivOffsetMsAt(firstGuess);
    let utc = new Date(wallAsUtc - offset);
    const refinedOffset = kyivOffsetMsAt(utc);
    if (refinedOffset !== offset) utc = new Date(wallAsUtc - refinedOffset);
    return utc;
}

function minutesFromTime(value) {
    const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})/);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return hours * 60 + minutes;
}

function bookingActualMenuTaskDeadline(booking = {}) {
    const date = cleanText(booking.date, 20);
    const startMinutes = minutesFromTime(booking.time);
    if (!date || startMinutes === null) return null;
    const duration = Number(booking.duration || 0);
    const safeDuration = Number.isFinite(duration) && duration > 0 ? Math.min(duration, 24 * 60) : 0;
    const endMinutes = startMinutes + safeDuration;
    const utc = kyivWallTimeToUtc(date, endMinutes);
    return utc && !Number.isNaN(utc.getTime()) ? utc.toISOString() : null;
}

function bookingActualMenuTaskDescription(booking = {}) {
    const bookingPackage = bookingPackageOf(booking);
    const workflow = menuWorkflowOf(booking);
    const snapshot = parseObject(workflow.minimumSnapshot || workflow.minimum_snapshot);
    const status = bookingPackage.banquetPreorderStatus || bookingPackage.banquet_preorder_status || {};
    const minimum = money(snapshot.minimumAmount ?? snapshot.minimum_amount ?? status.requiredMenuMinimum ?? status.required_menu_minimum, 0);
    const current = money(bookingPackage.positionsSubtotal ?? bookingPackage.positions_subtotal ?? status.currentMenuSubtotal ?? status.current_menu_subtotal, 0);
    const missing = Math.max(0, minimum - current);
    const lines = [
        `Бронювання: ${cleanText(booking.id, 100) || '—'}`,
        `Подія: ${cleanText(booking.date, 20) || '—'} ${cleanText(booking.time, 20) || ''}`.trim(),
        `Кімната/столик: ${cleanText(booking.room, 120) || '—'}`,
        `Фактичне меню зараз: ${current} UAH`,
        minimum > 0 ? `Minimum snapshot: ${minimum} UAH` : null,
        missing > 0 ? `Різниця до мінімуму: ${missing} UAH` : null,
        'Після внесення фактичного меню натисніть “Закрити меню по факту” у бронюванні.'
    ];
    return lines.filter(Boolean).join('\n');
}

function bookingActualMenuTaskOwnerInput(booking = {}, actor = {}) {
    const manager = cleanText(
        booking.manager
        || booking.manager_name
        || booking.createdBy
        || booking.created_by
        || actor?.username
        || actor?.name,
        120
    );
    return {
        assigned_to: manager,
        owner: manager
    };
}

async function findActualMenuTasks(queryable, bookingId, businessContext) {
    const result = await queryable.query(
        `SELECT *
           FROM tasks
          WHERE COALESCE(business_context, 'event_genix') = $1
            AND source_type = $2
            AND source_id = $3
            AND source_module = $4
          ORDER BY CASE WHEN ${ACTIVE_TASK_STATUS_SQL} THEN 0 ELSE 1 END, id ASC`,
        [businessContext || 'event_genix', MENU_ACTUAL_TASK_SOURCE_TYPE, String(bookingId), MENU_ACTUAL_TASK_SOURCE_MODULE]
    );
    return result.rows || [];
}

function activeTasks(rows = []) {
    return rows.filter(row => !['done', 'archived', 'cancelled'].includes(String(row.status || 'todo').toLowerCase()));
}

async function closeTasks(queryable, tasks = [], status, actor = {}, reason = null) {
    const ids = tasks.map(task => Number(task.id)).filter(id => Number.isInteger(id) && id > 0);
    if (!ids.length) return [];
    const workflowState = status === 'done' ? 'done' : 'archived';
    const scheduleStatus = status === 'done' ? 'completed' : 'cancelled';
    const archiveReason = status === 'done' ? null : (reason || 'booking_menu_actual_closed');
    const result = await queryable.query(
        `UPDATE tasks
            SET status = $2::text,
                workflow_state = $3::text,
                schedule_status = $4::text,
                completed_at = CASE WHEN $2::text = 'done' THEN COALESCE(completed_at, NOW()) ELSE completed_at END,
                archived_at = CASE WHEN $2::text <> 'done' THEN COALESCE(archived_at, NOW()) ELSE archived_at END,
                archive_reason = CASE WHEN $2::text <> 'done' THEN $5::text ELSE archive_reason END,
                updated_at = NOW(),
                control_meta = COALESCE(control_meta, '{}'::jsonb) || $6::jsonb
          WHERE id = ANY($1::int[])
          RETURNING *`,
        [ids, status, workflowState, scheduleStatus, archiveReason, JSON.stringify({ menuWorkflowClosedBy: cleanText(actor?.username || actor?.name, 120), menuWorkflowCloseReason: reason || status })]
    );
    return result.rows || [];
}

async function updateActiveTask(queryable, task, booking, businessContext, actor = {}) {
    const deadline = bookingActualMenuTaskDeadline(booking);
    const description = bookingActualMenuTaskDescription(booking);
    const ownerInput = bookingActualMenuTaskOwnerInput(booking, actor);
    const result = await queryable.query(
        `UPDATE tasks
            SET title = $2,
                description = $3,
                date = $4,
                deadline = $5::timestamptz,
                priority = 'high',
                category = 'booking',
                task_mode = 'work',
                task_kind = 'action',
                visibility = 'team',
                workflow_state = CASE WHEN COALESCE(workflow_state, 'todo') = 'inbox' THEN 'todo' ELSE COALESCE(workflow_state, 'todo') END,
                schedule_status = CASE WHEN $5::timestamptz IS NULL THEN COALESCE(schedule_status, 'unscheduled') ELSE 'scheduled' END,
                assigned_to = COALESCE(NULLIF($6, ''), assigned_to),
                owner = COALESCE(NULLIF($7, ''), owner),
                related_entity_type = 'booking',
                related_entity_id = $8,
                source_module = $9,
                control_meta = COALESCE(control_meta, '{}'::jsonb) || $10::jsonb,
                updated_at = NOW()
          WHERE id = $1
          RETURNING *`,
        [
            task.id,
            MENU_ACTUAL_TASK_TITLE,
            description,
            cleanText(booking.date, 20),
            deadline,
            ownerInput.assigned_to,
            ownerInput.owner,
            String(booking.id),
            MENU_ACTUAL_TASK_SOURCE_MODULE,
            JSON.stringify({
                bookingId: String(booking.id),
                sourceModule: MENU_ACTUAL_TASK_SOURCE_MODULE,
                deadlineBasis: 'booking_event_end_europe_kyiv',
                syncedBy: cleanText(actor?.username || actor?.name, 120) || 'system'
            })
        ]
    );
    return result.rows[0] || task;
}

async function createActualMenuTask(queryable, booking, businessContext, actor = {}) {
    const ownerInput = bookingActualMenuTaskOwnerInput(booking, actor);
    const task = await createTask({
        businessContext,
        title: MENU_ACTUAL_TASK_TITLE,
        description: bookingActualMenuTaskDescription(booking),
        date: cleanText(booking.date, 20),
        priority: 'high',
        deadline: bookingActualMenuTaskDeadline(booking),
        assigned_to: ownerInput.assigned_to,
        owner: ownerInput.owner,
        created_by: cleanText(actor?.username || actor?.name, 120) || 'system',
        created_by_user_id: actor?.id || null,
        source_type: MENU_ACTUAL_TASK_SOURCE_TYPE,
        source_id: String(booking.id),
        source_module: MENU_ACTUAL_TASK_SOURCE_MODULE,
        related_entity_type: 'booking',
        related_entity_id: String(booking.id),
        category: 'booking',
        task_type: 'human',
        type: 'auto_complete',
        task_mode: 'work',
        task_kind: 'action',
        visibility: 'team',
        workflow_state: 'todo',
        control_meta: {
            bookingId: String(booking.id),
            sourceModule: MENU_ACTUAL_TASK_SOURCE_MODULE,
            deadlineBasis: 'booking_event_end_europe_kyiv'
        },
        duplicateMode: 'skip'
    }, {
        pool: queryable,
        skipNotifications: true,
        skipHermesOutbox: true
    });
    if (task?.duplicateSkipped) return updateActiveTask(queryable, task, booking, businessContext, actor);
    return updateActiveTask(queryable, task, booking, businessContext, actor);
}

async function syncBanquetActualMenuTask(queryable, booking = {}, options = {}) {
    if (!queryable || typeof queryable.query !== 'function') throw new Error('queryable is required');
    const bookingId = cleanText(booking.id, 100);
    if (!bookingId) return { action: 'skipped', reason: 'missing_booking_id' };
    const businessContext = cleanText(options.businessContext || booking.businessContext || booking.business_context, 64) || 'event_genix';
    const actor = options.actor || {};
    const tasks = await findActualMenuTasks(queryable, bookingId, businessContext);
    const active = activeTasks(tasks);

    if (isActualAwaitingBooking(booking)) {
        const canonical = active[0] || null;
        const duplicates = active.slice(1);
        if (duplicates.length) await closeTasks(queryable, duplicates, 'cancelled', actor, 'duplicate_actual_menu_task');
        const task = canonical
            ? await updateActiveTask(queryable, canonical, booking, businessContext, actor)
            : await createActualMenuTask(queryable, booking, businessContext, actor);
        return { action: canonical ? 'updated' : 'created', task, duplicateClosedCount: duplicates.length };
    }

    if (isActualFinalizedBooking(booking)) {
        const completed = await closeTasks(queryable, active, 'done', actor, 'actual_menu_finalized');
        return { action: completed.length ? 'completed' : 'noop', tasks: completed };
    }

    if (String(booking.status || '').trim().toLowerCase() === 'cancelled' || options.cancel === true) {
        const cancelled = await closeTasks(queryable, active, 'cancelled', actor, 'booking_cancelled');
        return { action: cancelled.length ? 'cancelled' : 'noop', tasks: cancelled };
    }

    return { action: 'noop', reason: 'not_actual_menu_workflow' };
}

module.exports = {
    MENU_ACTUAL_TASK_SOURCE_MODULE,
    MENU_ACTUAL_TASK_SOURCE_TYPE,
    MENU_ACTUAL_TASK_TITLE,
    bookingActualMenuTaskDeadline,
    bookingActualMenuTaskDescription,
    bookingActualMenuTaskOwnerInput,
    findActualMenuTasks,
    isActualAwaitingBooking,
    isActualFinalizedBooking,
    syncBanquetActualMenuTask
};
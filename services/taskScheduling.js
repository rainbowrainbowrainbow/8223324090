const { pool } = require('../db');
const {
    buildTaskVisibilityScope,
    canRescheduleTask,
    normalizeUserId,
    taskOwnerState,
    userDisplayName
} = require('./taskPolicy');
const {
    DEFAULT_TASK_SOURCE_SURFACE,
    TASK_ACTION_TYPES,
    logTaskActionEvent
} = require('./taskActionHistory');
const {
    activeTaskBusinessContext,
    appendTaskBusinessScopeSql,
    pushTaskBusinessScopeCondition
} = require('./taskBusinessScope');

const DEFAULT_DURATION_MINUTES = 30;
const KYIV_TIME_ZONE = 'Europe/Kyiv';

const DAY_SLOTS = Object.freeze([
    { key: 'morning', icon: 'sunrise', label: 'Ранок', start: '09:00', end: '12:00' },
    { key: 'midday', icon: 'sun', label: 'День', start: '12:00', end: '15:00' },
    { key: 'afternoon', icon: 'cloud-sun', label: 'Після обіду', start: '15:00', end: '18:00' },
    { key: 'evening', icon: 'moon', label: 'Вечір', start: '18:00', end: '21:00' }
]);

const SLOT_KEYS = new Set(DAY_SLOTS.map(slot => slot.key));
const SCHEDULE_STATUSES = new Set(['unscheduled', 'scheduled', 'proposal', 'missed', 'completed', 'cancelled']);
const SCHEDULE_MODES = new Set(['slot', 'manual', 'proposal', 'legacy']);

function parsePositiveInt(value, fallback = null) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function safeJson(value, fallback = null) {
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

function isoValue(value) {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function dateOnly(value) {
    if (!value) return null;
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value.slice(0, 10);
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: KYIV_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(parsed);
}

function todayKyivDate(now = new Date()) {
    return dateOnly(now);
}

function addDays(dateText, days) {
    const [year, month, day] = String(dateText).split('-').map(Number);
    if (!year || !month || !day) return todayKyivDate();
    const date = new Date(Date.UTC(year, month - 1, day + Number(days || 0), 12, 0, 0));
    return date.toISOString().slice(0, 10);
}

function minutesFromTime(value) {
    const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return hours * 60 + minutes;
}

function timeFromMinutes(value) {
    const total = Math.max(0, Math.min(24 * 60, Number(value) || 0));
    const hours = Math.floor(total / 60);
    const minutes = total % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function kyivParts(date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
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
    return parts;
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

function normalizeDateTimeInput(value) {
    if (!value) return null;
    const raw = String(value).trim();
    const localMatch = raw.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/);
    if (localMatch) {
        return kyivWallTimeToUtc(localMatch[1], Number(localMatch[2]) * 60 + Number(localMatch[3]))?.toISOString() || null;
    }
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function slotByKey(key) {
    return DAY_SLOTS.find(slot => slot.key === key) || null;
}

function normalizeSlot(value) {
    const raw = String(value || '').trim().toLowerCase();
    return SLOT_KEYS.has(raw) ? raw : null;
}

function schedulePayload(input = {}) {
    return input.schedule && typeof input.schedule === 'object' ? input.schedule : {};
}

function hasSchedulePayload(input = {}) {
    const schedule = schedulePayload(input);
    const keys = [
        'scheduleSlot', 'schedule_slot', 'slot', 'scheduledDate', 'scheduled_date',
        'durationMinutes', 'duration_minutes', 'scheduledStartAt', 'scheduled_start_at',
        'scheduledEndAt', 'scheduled_end_at', 'scheduleMode', 'schedule_mode'
    ];
    return Object.keys(schedule).length > 0 || keys.some(key => input[key] !== undefined);
}

function durationFromInput(input = {}, fallback = DEFAULT_DURATION_MINUTES) {
    const schedule = schedulePayload(input);
    const raw = schedule.durationMinutes ?? schedule.duration_minutes
        ?? input.durationMinutes ?? input.duration_minutes
        ?? input.effortMinutes ?? input.effort_minutes
        ?? fallback;
    const parsed = parsePositiveInt(raw, fallback);
    return Math.max(5, Math.min(8 * 60, parsed || DEFAULT_DURATION_MINUTES));
}

function scheduleDateFromInput(input = {}, task = {}, now = new Date()) {
    const schedule = schedulePayload(input);
    const manualStart = schedule.startAt ?? schedule.scheduledStartAt ?? schedule.scheduled_start_at
        ?? input.scheduledStartAt ?? input.scheduled_start_at;
    if (manualStart) return dateOnly(normalizeDateTimeInput(manualStart));
    const raw = schedule.date ?? schedule.scheduledDate ?? schedule.scheduled_date
        ?? input.scheduledDate ?? input.scheduled_date
        ?? input.date ?? task.date ?? task.scheduled_start_at ?? task.deadline;
    return dateOnly(raw) || todayKyivDate(now);
}

function normalizeManualRange(input = {}, durationMinutes = DEFAULT_DURATION_MINUTES) {
    const schedule = schedulePayload(input);
    const start = normalizeDateTimeInput(
        schedule.startAt ?? schedule.scheduledStartAt ?? schedule.scheduled_start_at
        ?? input.scheduledStartAt ?? input.scheduled_start_at
    );
    if (!start) return null;
    const explicitEnd = normalizeDateTimeInput(
        schedule.endAt ?? schedule.scheduledEndAt ?? schedule.scheduled_end_at
        ?? input.scheduledEndAt ?? input.scheduled_end_at
    );
    const startDate = new Date(start);
    const end = explicitEnd || new Date(startDate.getTime() + durationMinutes * 60 * 1000).toISOString();
    return { start, end };
}

function normalizeScheduleRequest(input = {}, task = {}, now = new Date()) {
    if (!hasSchedulePayload(input)) return null;
    const schedule = schedulePayload(input);
    const durationMinutes = durationFromInput(input, task.effort_minutes || DEFAULT_DURATION_MINUTES);
    const manualRange = normalizeManualRange(input, durationMinutes);
    if (manualRange) {
        const date = dateOnly(manualRange.start) || scheduleDateFromInput(input, task, now);
        return {
            mode: 'manual',
            slot: 'manual',
            date,
            durationMinutes,
            scheduledStartAt: manualRange.start,
            scheduledEndAt: manualRange.end
        };
    }

    const slot = normalizeSlot(schedule.slot ?? schedule.scheduleSlot ?? schedule.schedule_slot ?? input.scheduleSlot ?? input.schedule_slot ?? input.slot);
    if (!slot) {
        const err = new Error('Valid schedule slot or manual scheduledStartAt is required');
        err.statusCode = 400;
        err.code = 'INVALID_TASK_SCHEDULE';
        throw err;
    }
    return {
        mode: 'slot',
        slot,
        date: scheduleDateFromInput(input, task, now),
        durationMinutes
    };
}

function scheduleWindowForSlot(date, slotKey, startOverride = null, endOverride = null) {
    if (slotKey === 'manual' && startOverride && endOverride) {
        return {
            start: new Date(startOverride),
            end: new Date(endOverride),
            startLabel: timeFromMinutes(minutesFromTime(startOverride.slice(11, 16)) || 0),
            endLabel: timeFromMinutes(minutesFromTime(endOverride.slice(11, 16)) || 0)
        };
    }
    const slot = slotByKey(slotKey);
    if (!slot) return null;
    const startMinutes = minutesFromTime(slot.start);
    const endMinutes = minutesFromTime(slot.end);
    return {
        start: kyivWallTimeToUtc(date, startMinutes),
        end: kyivWallTimeToUtc(date, endMinutes),
        startLabel: slot.start,
        endLabel: slot.end
    };
}

function roundUpToStep(date, stepMinutes = 15) {
    const stepMs = stepMinutes * 60 * 1000;
    return new Date(Math.ceil(date.getTime() / stepMs) * stepMs);
}

async function loadScheduledIntervals(query, { ownerUserId, start, end, excludeTaskId = null, businessContext = null }) {
    if (!ownerUserId) return [];
    const params = [ownerUserId, start.toISOString(), end.toISOString(), excludeTaskId];
    const businessCondition = businessContext
        ? `AND ${pushTaskBusinessScopeCondition(params, businessContext, '')}`
        : '';
    const result = await query.query(
        `SELECT id, scheduled_start_at, scheduled_end_at
         FROM tasks
         WHERE owner_user_id = $1
           AND id <> COALESCE($4, -1)
           ${businessCondition}
           AND scheduled_start_at IS NOT NULL
           AND scheduled_end_at IS NOT NULL
           AND COALESCE(schedule_status, 'unscheduled') = 'scheduled'
           AND COALESCE(status, 'todo') NOT IN ('done','cancelled','archived')
           AND scheduled_start_at < $3
           AND scheduled_end_at > $2
         ORDER BY scheduled_start_at ASC`,
        params
    );
    return result.rows.map(row => ({
        id: row.id,
        start: new Date(row.scheduled_start_at),
        end: new Date(row.scheduled_end_at)
    }));
}

async function findNearestWindow(query, { ownerUserId, date, slot, durationMinutes, excludeTaskId = null, businessContext = null }) {
    const bounds = scheduleWindowForSlot(date, slot);
    if (!bounds) return null;
    const durationMs = durationMinutes * 60 * 1000;
    if ((bounds.end.getTime() - bounds.start.getTime()) < durationMs) return null;

    const intervals = await loadScheduledIntervals(query, {
        ownerUserId,
        start: bounds.start,
        end: bounds.end,
        excludeTaskId,
        businessContext
    });
    let cursor = new Date(bounds.start);
    for (const interval of intervals) {
        const candidateEnd = new Date(cursor.getTime() + durationMs);
        if (candidateEnd <= interval.start) {
            return { start: cursor, end: candidateEnd, slotStart: bounds.start, slotEnd: bounds.end };
        }
        if (interval.end > cursor) cursor = roundUpToStep(interval.end, 15);
        if (cursor < bounds.start) cursor = new Date(bounds.start);
    }
    const finalEnd = new Date(cursor.getTime() + durationMs);
    if (finalEnd <= bounds.end) return { start: cursor, end: finalEnd, slotStart: bounds.start, slotEnd: bounds.end };
    return null;
}

async function buildScheduleProposals(query, request, task, limit = 4) {
    const proposals = [];
    const selectedIndex = Math.max(0, DAY_SLOTS.findIndex(slot => slot.key === request.slot));
    for (let dayOffset = 0; dayOffset <= 2 && proposals.length < limit; dayOffset += 1) {
        const date = addDays(request.date, dayOffset);
        for (let i = 0; i < DAY_SLOTS.length && proposals.length < limit; i += 1) {
            const slot = DAY_SLOTS[(selectedIndex + i) % DAY_SLOTS.length];
            const window = await findNearestWindow(query, {
                ownerUserId: task.owner_user_id || null,
                date,
                slot: slot.key,
                durationMinutes: request.durationMinutes,
                excludeTaskId: task.id,
                businessContext: activeTaskBusinessContext(task.business_context || task.businessContext)
            });
            if (window) {
                proposals.push({
                    date,
                    slot: slot.key,
                    label: slot.label,
                    startAt: window.start.toISOString(),
                    endAt: window.end.toISOString()
                });
            }
        }
    }
    return proposals;
}

function taskScheduleValue(task = {}) {
    return {
        date: task.date || null,
        deadline: isoValue(task.deadline),
        scheduledStartAt: isoValue(task.scheduled_start_at || task.scheduledStartAt),
        scheduledEndAt: isoValue(task.scheduled_end_at || task.scheduledEndAt),
        scheduleSlot: task.schedule_slot || task.scheduleSlot || null,
        scheduleMode: task.schedule_mode || task.scheduleMode || null,
        scheduleStatus: task.schedule_status || task.scheduleStatus || null,
        durationMinutes: task.effort_minutes || task.effortMinutes || null,
        proposal: safeJson(task.schedule_proposal || task.scheduleProposal, null)
    };
}

function actorSnapshot(actor = {}) {
    return {
        id: normalizeUserId(actor),
        username: actor?.username || null,
        name: userDisplayName(actor)
    };
}

function scheduleSourceSurface(value) {
    const raw = String(value || '').trim();
    if (['task_page', 'task_detail', 'profile_my_cabinet', 'alerts_panel', 'manager_queue_task_execution_v2'].includes(raw)) return raw;
    return DEFAULT_TASK_SOURCE_SURFACE;
}

async function notifyScheduleChange(task, actor, eventType, meta = {}) {
    try {
        const { sendToUser } = require('./websocket');
        const payload = {
            type: eventType,
            task: {
                id: task.id,
                title: task.title,
                scheduleStatus: task.schedule_status || null,
                scheduledStartAt: isoValue(task.scheduled_start_at),
                scheduledEndAt: isoValue(task.scheduled_end_at),
                scheduleSlot: task.schedule_slot || null
            },
            actor: actorSnapshot(actor),
            meta
        };
        const recipients = new Set();
        if (task.owner_user_id) recipients.add(String(task.owner_user_id));
        if (task.created_by_user_id && Number(task.created_by_user_id) !== Number(normalizeUserId(actor) || 0)) {
            recipients.add(String(task.created_by_user_id));
        }
        recipients.forEach(userId => sendToUser(userId, eventType, payload));
    } catch {
        // Websocket is best-effort; durable history remains source of truth.
    }
}

async function getVisibleTaskForSchedule(query, taskId, actor, options = {}) {
    const id = parsePositiveInt(taskId);
    if (!id) {
        const err = new Error('Valid taskId is required');
        err.statusCode = 400;
        err.code = 'INVALID_TASK_ID';
        throw err;
    }
    const params = [id];
    const visibility = buildTaskVisibilityScope(actor, params, 't');
    const businessScope = options.businessScope || options.businessContext || null;
    const businessCondition = businessScope ? appendTaskBusinessScopeSql(params, businessScope, 't') : '';
    const result = await query.query(
        `SELECT t.*, u.name AS owner_name, u.username AS owner_username
         FROM tasks t
         LEFT JOIN users u ON u.id = t.owner_user_id
         WHERE t.id = $1
           ${visibility}
           ${businessCondition}
         LIMIT 1`,
        params
    );
    if (!result.rows.length) {
        const err = new Error('Task not found or not visible');
        err.statusCode = 404;
        err.code = 'TASK_NOT_VISIBLE';
        throw err;
    }
    return result.rows[0];
}

async function withTransaction(options, work) {
    const query = options.pool || pool;
    if (typeof query.connect !== 'function' || typeof query.release === 'function') return work(query);
    const client = await query.connect();
    try {
        await client.query('BEGIN');
        const result = await work(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch {}
        throw err;
    } finally {
        client.release();
    }
}

function historyActionForSchedule(oldTask, updatedTask, request) {
    if (updatedTask.schedule_status === 'proposal') return TASK_ACTION_TYPES.SCHEDULE_PROPOSAL_CREATED;
    if (request.mode === 'manual') return TASK_ACTION_TYPES.SCHEDULE_MANUAL_OVERRIDE;
    if (!oldTask.scheduled_start_at && !oldTask.scheduled_end_at && !oldTask.schedule_slot) return TASK_ACTION_TYPES.SCHEDULED;
    return TASK_ACTION_TYPES.SCHEDULE_MOVED;
}

async function scheduleTask(taskId, input = {}, actor = {}, options = {}) {
    return withTransaction(options, async query => {
        const task = await getVisibleTaskForSchedule(query, taskId, actor, {
            businessScope: options.businessScope || options.businessContext
        });
        if (!canRescheduleTask(actor, task)) {
            const err = new Error('You cannot schedule this task');
            err.statusCode = 403;
            err.code = 'TASK_SCHEDULE_FORBIDDEN';
            throw err;
        }
        const request = normalizeScheduleRequest(input, task, options.now || new Date());
        const oldValue = taskScheduleValue(task);
        let update;
        let proposals = [];

        if (request.mode === 'manual') {
            const start = new Date(request.scheduledStartAt);
            const end = new Date(request.scheduledEndAt);
            update = {
                scheduledStartAt: start.toISOString(),
                scheduledEndAt: end.toISOString(),
                scheduleSlot: 'manual',
                scheduleMode: 'manual',
                scheduleStatus: 'scheduled',
                date: request.date,
                deadline: end.toISOString(),
                timeWindowStart: timeFromMinutes(minutesFromTime(start.toISOString().slice(11, 16)) || 0),
                timeWindowEnd: timeFromMinutes(minutesFromTime(end.toISOString().slice(11, 16)) || 0),
                proposal: null
            };
        } else {
            const slot = slotByKey(request.slot);
            const window = await findNearestWindow(query, {
                ownerUserId: task.owner_user_id || null,
                date: request.date,
                slot: request.slot,
                durationMinutes: request.durationMinutes,
                excludeTaskId: task.id,
                businessContext: activeTaskBusinessContext(task.business_context || task.businessContext)
            });
            if (window) {
                update = {
                    scheduledStartAt: window.start.toISOString(),
                    scheduledEndAt: window.end.toISOString(),
                    scheduleSlot: request.slot,
                    scheduleMode: 'slot',
                    scheduleStatus: 'scheduled',
                    date: request.date,
                    deadline: window.end.toISOString(),
                    timeWindowStart: slot.start,
                    timeWindowEnd: slot.end,
                    proposal: null
                };
            } else {
                proposals = await buildScheduleProposals(query, request, task);
                update = {
                    scheduledStartAt: null,
                    scheduledEndAt: null,
                    scheduleSlot: request.slot,
                    scheduleMode: 'proposal',
                    scheduleStatus: 'proposal',
                    date: request.date,
                    deadline: null,
                    timeWindowStart: slot.start,
                    timeWindowEnd: slot.end,
                    proposal: {
                        requested: {
                            date: request.date,
                            slot: request.slot,
                            durationMinutes: request.durationMinutes
                        },
                        alternatives: proposals
                    }
                };
            }
        }

        const result = await query.query(
            `UPDATE tasks
             SET date = $2,
                 deadline = $3,
                 time_window_start = $4,
                 time_window_end = $5,
                 effort_minutes = $6,
                 scheduled_start_at = $7,
                 scheduled_end_at = $8,
                 schedule_slot = $9,
                 schedule_mode = $10,
                 schedule_status = $11,
                 schedule_meta = $12::jsonb,
                 schedule_proposal = $13::jsonb,
                 snoozed_until = NULL,
                 escalate_after = CASE
                     WHEN priority = 'urgent' THEN COALESCE($7, $3, escalate_after)
                     ELSE escalate_after
                 END,
                 next_notification_at = CASE
                     WHEN priority = 'urgent' THEN COALESCE($7, $3, NOW() + INTERVAL '90 minutes')
                     ELSE next_notification_at
                 END,
                 missed_at = NULL,
                 missed_processed_at = NULL,
                 workflow_state = CASE
                     WHEN COALESCE(workflow_state, 'todo') IN ('done','archived','waiting') THEN workflow_state
                     ELSE 'scheduled'
                 END,
                 updated_at = NOW(),
                 version = COALESCE(version, 1) + 1
                 WHERE id = $1
                   AND COALESCE(version, 1) = $14
                   AND COALESCE(business_context, 'event_genix') = $15
                   AND COALESCE(status, 'todo') NOT IN ('done','cancelled','archived')
                 RETURNING *`,
            [
                task.id,
                update.date,
                update.deadline,
                update.timeWindowStart,
                update.timeWindowEnd,
                request.durationMinutes,
                update.scheduledStartAt,
                update.scheduledEndAt,
                update.scheduleSlot,
                update.scheduleMode,
                update.scheduleStatus,
                JSON.stringify({
                    sourceSurface: scheduleSourceSurface(options.sourceSurface || input.sourceSurface || input.source_surface),
                    actor: actorSnapshot(actor),
                    requestedAt: new Date().toISOString()
                }),
                update.proposal ? JSON.stringify(update.proposal) : null,
                    task.version || 1,
                    task.business_context || 'event_genix'
                ]
            );
        if (!result.rows.length) {
            const err = new Error('Task is already closed or was changed by another user');
            err.statusCode = 409;
            err.code = 'TASK_STALE_WRITE';
            throw err;
        }
        const updated = result.rows[0];
        const actionType = historyActionForSchedule(task, updated, request);
        const historyEvent = await logTaskActionEvent({
            taskId: task.id,
            actionType,
            actor,
            sourceSurface: scheduleSourceSurface(options.sourceSurface || input.sourceSurface || input.source_surface),
            oldValue,
            newValue: taskScheduleValue(updated),
            summary: updated.schedule_status === 'proposal' ? 'Task schedule proposal created' : 'Task schedule updated',
            meta: {
                route: options.route || 'task_schedule',
                ownerStateBefore: taskOwnerState(task),
                canonicalFields: ['tasks.scheduled_start_at', 'tasks.scheduled_end_at', 'tasks.schedule_slot'],
                proposals
            }
        }, { pool: query });
        await notifyScheduleChange(updated, actor, 'task:schedule_changed', { actionType, proposals });
        return { task: attachTaskSchedule(updated), historyEvent, proposals };
    });
}

async function getAvailability(input = {}, options = {}) {
    const query = options.pool || pool;
    const request = normalizeScheduleRequest({ schedule: input }, {}, options.now || new Date());
    const ownerUserId = parsePositiveInt(input.ownerUserId ?? input.owner_user_id, null);
    const window = request.mode === 'slot'
        ? await findNearestWindow(query, {
            ownerUserId,
            date: request.date,
            slot: request.slot,
            durationMinutes: request.durationMinutes,
            excludeTaskId: input.excludeTaskId ?? input.exclude_task_id,
            businessContext: options.businessContext || options.businessScope || null
        })
        : null;
    return {
        available: Boolean(window),
        date: request.date,
        slot: request.slot,
        durationMinutes: request.durationMinutes,
        window: window ? { startAt: window.start.toISOString(), endAt: window.end.toISOString() } : null
    };
}

function getSchedulePolicy() {
    return {
        version: 'task_scheduling_v1',
        timezone: KYIV_TIME_ZONE,
        defaultDurationMinutes: DEFAULT_DURATION_MINUTES,
        decisions: {
            slots: 'fixed_global',
            fullSlotBehavior: 'proposal_requires_confirmation',
            missedPenalty: 'discipline_score_only',
            chatTasks: 'separate_model'
        },
        slots: DAY_SLOTS
    };
}

function scheduleStatusLabel(status) {
    return {
        scheduled: 'Заплановано',
        proposal: 'Потрібне підтвердження',
        missed: 'Слот пропущено',
        completed: 'Виконано',
        cancelled: 'Скасовано',
        unscheduled: 'Без часу'
    }[status] || 'Без часу';
}

function attachTaskSchedule(row = {}) {
    const status = SCHEDULE_STATUSES.has(row.schedule_status) ? row.schedule_status : (row.scheduled_start_at ? 'scheduled' : 'unscheduled');
    const mode = SCHEDULE_MODES.has(row.schedule_mode) ? row.schedule_mode : (row.scheduled_start_at ? 'legacy' : 'legacy');
    const slot = row.schedule_slot || (row.scheduled_start_at ? 'manual' : null);
    return {
        ...row,
        scheduledStartAt: isoValue(row.scheduled_start_at),
        scheduledEndAt: isoValue(row.scheduled_end_at),
        scheduleSlot: slot,
        scheduleMode: mode,
        scheduleStatus: status,
        scheduleMeta: safeJson(row.schedule_meta, {}),
        scheduleProposal: safeJson(row.schedule_proposal, null),
        missedAt: isoValue(row.missed_at),
        missedProcessedAt: isoValue(row.missed_processed_at),
        createdByUserId: row.created_by_user_id || null,
        schedule: {
            startAt: isoValue(row.scheduled_start_at),
            endAt: isoValue(row.scheduled_end_at),
            slot,
            mode,
            status,
            statusLabel: scheduleStatusLabel(status),
            durationMinutes: row.effort_minutes || null,
            proposal: safeJson(row.schedule_proposal, null)
        },
        scheduleSort: scheduleSortMeta(row)
    };
}

function scheduleSortMeta(row = {}, now = new Date()) {
    const hasExactTime = Boolean(row.scheduled_start_at || row.scheduledStartAt);
    const day = dateOnly(row.scheduled_start_at || row.scheduledStartAt || row.date || row.deadline);
    const today = todayKyivDate(now);
    return {
        hasExactTime,
        day,
        isToday: day === today,
        isFuture: Boolean(day && day > today),
        time: isoValue(row.scheduled_start_at || row.scheduledStartAt || row.deadline),
        order: [
            hasExactTime ? 1 : 0,
            day === today ? 0 : (day && day > today ? 1 : 2),
            isoValue(row.scheduled_start_at || row.scheduledStartAt || row.deadline || row.created_at || row.createdAt) || ''
        ]
    };
}

function canonicalTaskOrderSql(alias = 't') {
    const dayExpr = `COALESCE(
        (${alias}.scheduled_start_at AT TIME ZONE 'Europe/Kyiv')::date,
        (${alias}.snoozed_until AT TIME ZONE 'Europe/Kyiv')::date,
        CASE WHEN LEFT(COALESCE(${alias}.date, ''), 10) ~ '^\\d{4}-\\d{2}-\\d{2}$' THEN LEFT(${alias}.date, 10)::date END,
        (${alias}.deadline AT TIME ZONE 'Europe/Kyiv')::date
    )`;
    return `
        CASE WHEN ${alias}.scheduled_start_at IS NULL THEN 0 ELSE 1 END ASC,
        CASE
            WHEN ${dayExpr} = (NOW() AT TIME ZONE 'Europe/Kyiv')::date THEN 0
            WHEN ${dayExpr} > (NOW() AT TIME ZONE 'Europe/Kyiv')::date THEN 1
            ELSE 2
        END ASC,
        ${alias}.scheduled_start_at ASC NULLS LAST,
        ${alias}.snoozed_until ASC NULLS LAST,
        ${alias}.deadline ASC NULLS LAST`;
}

async function processMissedSlots(options = {}) {
    const query = options.pool || pool;
    const now = options.now ? new Date(options.now) : new Date();
    const limit = Math.max(1, Math.min(parseInt(options.limit, 10) || 50, 200));
    const candidates = await query.query(
        `SELECT *
         FROM tasks
         WHERE scheduled_end_at IS NOT NULL
           AND scheduled_end_at <= $1
           AND COALESCE(schedule_status, 'unscheduled') = 'scheduled'
           AND missed_processed_at IS NULL
           AND COALESCE(status, 'todo') NOT IN ('done','cancelled','archived')
         ORDER BY scheduled_end_at ASC
         LIMIT $2`,
        [now.toISOString(), limit]
    );
    const processed = [];
    for (const candidate of candidates.rows) {
        const result = await withTransaction({ pool: query }, async client => {
            const locked = await client.query(
                `SELECT * FROM tasks
                 WHERE id = $1
                   AND missed_processed_at IS NULL
                   AND COALESCE(schedule_status, 'unscheduled') = 'scheduled'
                 FOR UPDATE`,
                [candidate.id]
            );
            if (!locked.rows.length) return null;
            const task = locked.rows[0];
            const taskBusinessContext = activeTaskBusinessContext(task.business_context || task.businessContext);
            const eventKey = `task_slot_missed:${task.id}:${new Date(task.scheduled_end_at).toISOString()}`;
            const discipline = await client.query(
                `INSERT INTO task_discipline_events (
                    task_id, owner_user_id, creator_user_id, event_type, score_delta, event_key, metadata
                 ) VALUES ($1,$2,$3,'task_slot_missed',-1,$4,$5::jsonb)
                 ON CONFLICT (event_key) DO NOTHING
                 RETURNING *`,
                [
                    task.id,
                    task.owner_user_id || null,
                    task.created_by_user_id || null,
                    eventKey,
                    JSON.stringify({
                        scheduledStartAt: isoValue(task.scheduled_start_at),
                        scheduledEndAt: isoValue(task.scheduled_end_at),
                        scheduleSlot: task.schedule_slot || null,
                        businessContext: taskBusinessContext,
                        penaltyModel: 'discipline_score_only'
                    })
                ]
            );
            const updated = await client.query(
                `UPDATE tasks
                 SET schedule_status = 'missed',
                     missed_at = COALESCE(missed_at, $2),
                     missed_processed_at = $2,
                     schedule_discipline_delta = COALESCE(schedule_discipline_delta, 0) - CASE WHEN $3 THEN 1 ELSE 0 END,
                     updated_at = NOW(),
                     version = COALESCE(version, 1) + 1
                 WHERE id = $1
                   AND COALESCE(business_context, 'event_genix') = $4
                 RETURNING *`,
                [task.id, now.toISOString(), discipline.rowCount > 0, taskBusinessContext]
            );
            const actor = { username: 'scheduler', name: 'Scheduler' };
            const history = await logTaskActionEvent({
                taskId: task.id,
                actionType: TASK_ACTION_TYPES.SLOT_MISSED,
                actor,
                sourceSurface: 'services.scheduler',
                oldValue: taskScheduleValue(task),
                newValue: taskScheduleValue(updated.rows[0]),
                summary: 'Task schedule slot missed',
                meta: { eventKey, penaltyApplied: discipline.rowCount > 0, businessContext: taskBusinessContext }
            }, { pool: client });
            if (discipline.rowCount > 0) {
                await logTaskActionEvent({
                    taskId: task.id,
                    actionType: TASK_ACTION_TYPES.DISCIPLINE_PENALTY_APPLIED,
                    actor,
                    sourceSurface: 'services.scheduler',
                    oldValue: { disciplineDelta: task.schedule_discipline_delta || 0 },
                    newValue: { disciplineDelta: (task.schedule_discipline_delta || 0) - 1 },
                    summary: 'Task discipline penalty applied',
                    meta: { eventKey, model: 'discipline_score_only', businessContext: taskBusinessContext }
                }, { pool: client });
            }
            try {
                const { publish } = require('./eventBus');
                await publish('task.slot_missed', {
                    task_id: task.id,
                    owner_user_id: task.owner_user_id || null,
                    creator_user_id: task.created_by_user_id || null,
                    business_context: taskBusinessContext,
                    scheduled_end_at: isoValue(task.scheduled_end_at),
                    discipline_score_delta: discipline.rowCount > 0 ? -1 : 0
                }, eventKey);
            } catch {
                // Event bus is optional; history + task_discipline_events stay durable.
            }
            await notifyScheduleChange(updated.rows[0], actor, 'task:slot_missed', { eventKey, penaltyApplied: discipline.rowCount > 0, businessContext: taskBusinessContext });
            return { task: attachTaskSchedule(updated.rows[0]), historyEvent: history, eventKey, penaltyApplied: discipline.rowCount > 0 };
        });
        if (result) processed.push(result);
    }
    return { processedCount: processed.length, processed };
}

module.exports = {
    DAY_SLOTS,
    DEFAULT_DURATION_MINUTES,
    KYIV_TIME_ZONE,
    addDays,
    attachTaskSchedule,
    canonicalTaskOrderSql,
    dateOnly,
    durationFromInput,
    getAvailability,
    getSchedulePolicy,
    hasSchedulePayload,
    normalizeScheduleRequest,
    processMissedSlots,
    scheduleSortMeta,
    scheduleTask,
    scheduleWindowForSlot,
    todayKyivDate
};

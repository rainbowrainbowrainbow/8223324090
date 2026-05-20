const { getKyivDateStr } = require('./booking');
const { REPLY_SLA_STATES, deriveReplySlaState } = require('./replySla');
const { enrichQueueBuckets } = require('./queueIntelligence');
const { buildTaskVisibilityScope, taskOwnerState } = require('./taskPolicy');
const { getVisibleBookingScope, resolveBookingDerivedLinkedRoute } = require('./bookingVisibility');
const { attachTaskSchedule, canonicalTaskOrderSql } = require('./taskScheduling');

const BUCKETS = [
    { key: 'overdue', label: 'Прострочено' },
    { key: 'today', label: 'Сьогодні' },
    { key: 'tomorrow', label: 'Завтра' },
    { key: 'callback_due', label: 'Передзвонити' },
    { key: 'waiting_reply', label: 'Очікуємо відповідь' },
    { key: 'needs_confirmation', label: 'Підтвердити' },
    { key: 'event_soon', label: 'Подія скоро' }
];

const REPLY_BACKLOG_SCOPES = ['all', 'mine', 'team'];
const REPLY_SLA_FILTERS = ['all', 'overdue', 'due_soon', 'on_track', 'none'];
const REPLY_OWNER_FILTERS = ['all', 'with_owner', 'without_owner'];
const REPLY_ESCALATION_FILTERS = ['all', 'escalated', 'not_escalated'];
const CLOSED_LEAD_STAGES = ['completed', 'closed', 'lost'];
const ACTIVE_TASK_STATUS_SQL = "COALESCE(t.status, 'todo') NOT IN ('done','cancelled','archived')";
const PRIORITY_WEIGHT = { critical: 0, high: 1, normal: 2, medium: 2, low: 3 };

function addDays(dateStr, days) {
    const [year, month, day] = String(dateStr).split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + days));
    return date.toISOString().slice(0, 10);
}

function isoValue(value) {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString();
    return String(value);
}

function dateValue(value) {
    const raw = isoValue(value);
    return raw ? raw.slice(0, 10) : null;
}

function bookingDueAt(date, time) {
    const day = dateValue(date);
    if (!day) return null;
    const clock = String(time || '').match(/^(\d{2}):(\d{2})/)?.[0];
    return clock ? `${day}T${clock}:00` : day;
}

function kyivClock(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Kyiv',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(now).reduce((acc, part) => {
        if (part.type !== 'literal') acc[part.type] = part.value;
        return acc;
    }, {});
    return {
        date: `${parts.year}-${parts.month}-${parts.day}`,
        minutes: (Number(parts.hour) * 60) + Number(parts.minute)
    };
}

function minutesUntilBookingStart(row, now = new Date()) {
    const day = dateValue(row?.date);
    const clock = String(row?.time || '').match(/^(\d{2}):(\d{2})/);
    if (!day || !clock) return null;
    const current = kyivClock(now);
    if (day !== current.date) return null;
    return (Number(clock[1]) * 60 + Number(clock[2])) - current.minutes;
}

function isLatePreliminaryBooking(row, now = new Date()) {
    const minutes = minutesUntilBookingStart(row, now);
    return Number.isFinite(minutes) && minutes >= 0 && minutes <= 120;
}

function priority(value, fallback = 'normal') {
    const raw = String(value || fallback).toLowerCase();
    if (raw === 'medium') return 'normal';
    return ['critical', 'high', 'normal', 'low'].includes(raw) ? raw : fallback;
}

function pushParam(params, value) {
    params.push(value);
    return `$${params.length}`;
}

function normalizeReplyBacklogScope(value) {
    const raw = String(value || 'all').toLowerCase();
    return REPLY_BACKLOG_SCOPES.includes(raw) ? raw : 'all';
}

function normalizeReplySlaFilter(value) {
    const raw = String(value || 'all').toLowerCase();
    return REPLY_SLA_FILTERS.includes(raw) ? raw : 'all';
}

function normalizeReplyOwnerFilter(value) {
    const raw = String(value || 'all').toLowerCase();
    return REPLY_OWNER_FILTERS.includes(raw) ? raw : 'all';
}

function normalizeReplyEscalationFilter(value) {
    const raw = String(value || 'all').toLowerCase();
    return REPLY_ESCALATION_FILTERS.includes(raw) ? raw : 'all';
}

function normalizeUserId(user) {
    const parsed = Number(user?.id || user?.userId || 0);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function buildReplyBacklogScopeFilter(scope, user, params, alias = 'c') {
    const userId = normalizeUserId(user);
    if (scope === 'mine') {
        if (!userId) return 'AND 1 = 0';
        const userRef = pushParam(params, userId);
        return `AND ${alias}.reply_owner_user_id = ${userRef}`;
    }
    if (scope === 'team') {
        if (!userId) return '';
        const userRef = pushParam(params, userId);
        return `AND (${alias}.reply_owner_user_id IS NULL OR ${alias}.reply_owner_user_id <> ${userRef})`;
    }
    return '';
}

function buildReplyBacklogStateFilter({ sla = 'all', owner = 'all', escalation = 'all' } = {}, alias = 'c', escalationAlias = 'rt') {
    const filters = [];

    if (sla === 'overdue') {
        filters.push(`AND ${alias}.reply_sla_at IS NOT NULL AND ${alias}.reply_sla_at <= NOW()`);
    } else if (sla === 'due_soon') {
        filters.push(`AND ${alias}.reply_sla_at IS NOT NULL AND ${alias}.reply_sla_at > NOW() AND ${alias}.reply_sla_at <= NOW() + INTERVAL '4 hours'`);
    } else if (sla === 'on_track') {
        filters.push(`AND ${alias}.reply_sla_at IS NOT NULL AND ${alias}.reply_sla_at > NOW() + INTERVAL '4 hours'`);
    } else if (sla === 'none') {
        filters.push(`AND ${alias}.reply_sla_at IS NULL`);
    }

    if (owner === 'with_owner') {
        filters.push(`AND ${alias}.reply_owner_user_id IS NOT NULL`);
    } else if (owner === 'without_owner') {
        filters.push(`AND ${alias}.reply_owner_user_id IS NULL`);
    }

    if (escalation === 'escalated') {
        filters.push(`AND ${escalationAlias}.id IS NOT NULL`);
    } else if (escalation === 'not_escalated') {
        filters.push(`AND ${escalationAlias}.id IS NULL`);
    }

    return filters.join('\n              ');
}

function buildTaskVisibility(user, params, alias = 't') {
    return buildTaskVisibilityScope(user, params, alias);
}

function hrefForTask(row, actor = null) {
    const sourceType = row.task_source_type || row.source_type;
    const sourceId = row.task_source_id || row.source_id;
    const conversationId = row.linked_conversation_id;
    const leadId = row.linked_lead_id || (sourceType === 'lead' && /^\d+$/.test(String(sourceId || '')) ? Number(sourceId) : null);
    const linkedBookingVisible = row.linked_booking_visible === true || row.linked_booking_visible === 'true';
    const bookingId = row.linked_booking_id || (linkedBookingVisible && sourceType === 'booking' ? sourceId : null);
    const bookingDate = row.linked_booking_date || row.booking_date;

    if (conversationId) return `/omni?conversation=${encodeURIComponent(conversationId)}`;
    if (leadId) return `/sales-funnel?lead=${encodeURIComponent(leadId)}`;
    if (bookingId && bookingDate) {
        const route = resolveBookingDerivedLinkedRoute(
            actor,
            {
                id: bookingId,
                date: bookingDate,
                customer_id: row.linked_customer_id || null,
                visible: linkedBookingVisible
            },
            { type: 'task', id: row.id, visible: true }
        );
        return route.href || `/?date=${encodeURIComponent(dateValue(bookingDate))}&highlight=${encodeURIComponent(bookingId)}`;
    }
    return `/tasks?open=${encodeURIComponent(row.id)}`;
}

function bookingDerivedTaskRoute(row, actor = null) {
    const sourceType = row.task_source_type || row.source_type;
    const sourceId = row.task_source_id || row.source_id;
    const linkedBookingVisible = row.linked_booking_visible === true || row.linked_booking_visible === 'true';
    const bookingId = row.linked_booking_id || (linkedBookingVisible && sourceType === 'booking' ? sourceId : null);
    const bookingDate = row.linked_booking_date || row.booking_date;
    if (!bookingId || !bookingDate) return null;
    return resolveBookingDerivedLinkedRoute(
        actor,
        {
            id: bookingId,
            date: bookingDate,
            customer_id: row.linked_customer_id || null,
            visible: linkedBookingVisible
        },
        { type: 'task', id: row.id, visible: true }
    );
}

function taskItem(row, bucket, options = {}) {
    const scheduled = attachTaskSchedule(row);
    const sourceType = row.task_source_type || row.source_type || null;
    const sourceId = row.task_source_id || row.source_id || null;
    const leadId = row.linked_lead_id || (sourceType === 'lead' && /^\d+$/.test(String(sourceId || '')) ? Number(sourceId) : null);
    const linkedBookingVisible = row.linked_booking_visible === true || row.linked_booking_visible === 'true';
    const bookingId = row.linked_booking_id || (linkedBookingVisible && sourceType === 'booking' ? sourceId : null);
    const conversationId = row.linked_conversation_id || null;
    const dueAt = scheduled.scheduledStartAt || isoValue(row.deadline) || dateValue(row.date);
    const hasExactCase = Boolean(conversationId || leadId || bookingId);
    const ownerState = taskOwnerState(row);
    const ownerLabel = row.owner_name || row.owner_username || row.assigned_to || row.owner || null;
    const bookingRoute = bookingDerivedTaskRoute(row, options.actor);

    return {
        id: `task:${bucket}:${row.id}`,
        bucket,
        sourceType: 'task',
        sourceId: String(row.id),
        taskId: row.id,
        leadId: leadId || null,
        customerId: row.linked_customer_id || null,
        bookingId: bookingId || null,
        title: row.title || 'Задача',
        subtitle: row.description || null,
        dueAt,
        priority: priority(row.priority),
        confidence: hasExactCase ? 'exact' : (row.deadline ? 'durable' : 'suggested'),
        actionLabel: hasExactCase ? 'Відкрити кейс' : 'Відкрити задачу',
        href: hrefForTask(row, options.actor),
        meta: {
            status: row.status || null,
            category: row.category || null,
            assignedTo: ownerLabel,
            ownerUserId: row.owner_user_id || null,
            ownerState,
            legacyAssignedTo: row.assigned_to || null,
            legacyOwner: row.owner || null,
            taskSourceType: sourceType,
            taskSourceId: sourceId,
            linkedBookingVisible,
            bookingLinkedRoute: bookingRoute ? {
                href: bookingRoute.href,
                fallbackHref: bookingRoute.fallbackHref || null,
                routeKind: bookingRoute.routeKind,
                reason: bookingRoute.reason
            } : null,
            version: row.version || null,
            schedule: scheduled.schedule,
            scheduleSort: scheduled.scheduleSort,
            updatedAt: isoValue(row.updated_at),
            createdAt: isoValue(row.created_at),
            conversationId,
            canTaskExecute: options.canExecute === true,
            taskExecutionUnavailableReason: options.canExecute === true
                ? null
                : 'Task is visible, but inline execution is unavailable for this item.',
            signal: options.signal || (row.deadline ? 'deadline' : 'date')
        }
    };
}

function leadHref(id) {
    return `/sales-funnel?lead=${encodeURIComponent(id)}`;
}

function leadTitle(row) {
    return row.client_name || row.customer_name || row.name || `Лід #${row.id || row.lead_id}`;
}

const LEAD_FUNNEL_STAGE_LABELS = {
    new: 'Нові',
    contacted: 'Контакт',
    info_sent: 'Надіслано інфо',
    deal: 'В роботі',
    negotiation: 'Переговори',
    booked: 'Бронь',
    completed: 'Завершено',
    closed: 'Закрито',
    lost: 'Втрачено'
};

function normalizeFunnelStage(stage) {
    return String(stage || 'new').trim().toLowerCase() || 'new';
}

function leadFunnelStageLabel(stage) {
    const normalized = normalizeFunnelStage(stage);
    return LEAD_FUNNEL_STAGE_LABELS[normalized] || normalized.replace(/[_-]+/g, ' ');
}

function leadFunnelHref(stage = '') {
    const normalized = normalizeFunnelStage(stage);
    return normalized ? `/sales-funnel?stage=${encodeURIComponent(normalized)}` : '/sales-funnel';
}

function normalizeLeadFunnelInsights(rows = []) {
    const stages = (Array.isArray(rows) ? rows : []).map(row => {
        const stage = normalizeFunnelStage(row.stage || row.pipeline_stage);
        const total = Number(row.total || 0);
        const waitingAction = Number(row.waiting_action || row.waiting_action_count || row.stale_count || 0);
        return {
            stage,
            label: leadFunnelStageLabel(stage),
            total,
            waitingAction,
            oldestTouchAt: isoValue(row.oldest_touch_at),
            href: leadFunnelHref(stage)
        };
    }).filter(row => row.total > 0);

    const total = stages.reduce((sum, row) => sum + row.total, 0);
    const waitingAction = stages.reduce((sum, row) => sum + row.waitingAction, 0);
    const hotStage = stages
        .slice()
        .sort((a, b) => b.waitingAction - a.waitingAction || b.total - a.total || a.label.localeCompare(b.label))[0] || null;

    return {
        model: 'lead_funnel_summary_v1',
        source: 'leads.pipeline_stage + leads.last_contact_at_or_created_at',
        total,
        waitingAction,
        stages,
        hotStage,
        href: '/sales-funnel'
    };
}

function leadItem(row, bucket, options = {}) {
    const leadId = row.lead_id || row.id;
    return {
        id: `${bucket}:lead:${leadId}:${row.source_id || row.interaction_id || row.id}`,
        bucket,
        sourceType: options.sourceType || 'lead',
        sourceId: String(row.source_id || row.interaction_id || leadId),
        taskId: null,
        leadId,
        customerId: row.customer_id || null,
        bookingId: row.booking_id || null,
        title: options.title || leadTitle(row),
        subtitle: options.subtitle || row.summary || row.details || row.phone || null,
        dueAt: isoValue(row.due_at || row.follow_up_date || row.event_date || row.last_contact_at || row.created_at),
        priority: options.priority || 'normal',
        confidence: options.confidence || 'durable',
        actionLabel: 'Відкрити кейс',
        href: leadHref(leadId),
        meta: {
            pipelineStage: row.pipeline_stage || null,
            assignedTo: row.assigned_name || row.assigned_to || null,
            signal: options.signal || bucket
        }
    };
}

function conversationTitle(row) {
    return row.customer_name || row.customer_phone || `Conversation #${row.conversation_id}`;
}

function conversationItem(row, bucket = 'waiting_reply') {
    const dueAt = isoValue(row.due_at || row.reply_sla_at || row.awaiting_reply_since);
    const conversationHref = `/omni?conversation=${encodeURIComponent(row.conversation_id)}`;
    const leadHrefValue = row.lead_id ? leadHref(row.lead_id) : null;
    const replySlaState = deriveReplySlaState(row);
    return {
        id: `${bucket}:conversation:${row.conversation_id}`,
        bucket,
        sourceType: 'conversation',
        sourceId: String(row.conversation_id),
        taskId: null,
        escalationTaskId: row.reply_escalation_task_id || null,
        leadId: row.lead_id || null,
        customerId: row.customer_id || null,
        bookingId: null,
        title: `Очікуємо відповідь: ${conversationTitle(row)}`,
        subtitle: [row.channel, row.customer_phone].filter(Boolean).join(' · ') || null,
        dueAt,
        priority: replySlaState === REPLY_SLA_STATES.OVERDUE ? 'high' : 'normal',
        confidence: 'exact',
        actionLabel: 'Відкрити чат',
        href: conversationHref,
        meta: {
            assignedTo: row.reply_owner || row.assigned_to || null,
            signal: 'conversations.reply_expected',
            state: 'waiting_reply',
            conversationId: row.conversation_id,
            replyOwnerUserId: row.reply_owner_user_id || null,
            waitingSince: isoValue(row.awaiting_reply_since),
            awaitingReplySince: isoValue(row.awaiting_reply_since),
            replySlaAt: isoValue(row.reply_sla_at),
            replySlaState,
            replyExpectedMessageId: row.reply_expected_message_id || null,
            replyEscalationTaskId: row.reply_escalation_task_id || null,
            replyEscalationHref: row.reply_escalation_task_id ? `/tasks?open=${encodeURIComponent(row.reply_escalation_task_id)}` : null,
            deliveryStatus: row.delivery_status || null,
            lastInboundAt: isoValue(row.last_inbound_at),
            lastOutboundAt: isoValue(row.last_outbound_at),
            exactHref: conversationHref,
            leadHref: leadHrefValue,
        }
    };
}

function bookingItem(row, bucket, options = {}) {
    const dueAt = bookingDueAt(row.date, row.time);
    const minutesUntilStart = options.minutesUntilStart ?? null;
    const latePreliminary = options.latePreliminary === true;
    const leadRoute = row.lead_id ? resolveBookingDerivedLinkedRoute(
        options.actor || null,
        { id: row.id, date: row.date, customer_id: row.customer_id || null, visible: true },
        { type: 'lead', id: row.lead_id, visible: options.leadVisible === true }
    ) : null;
    const customerRoute = row.customer_id ? resolveBookingDerivedLinkedRoute(
        options.actor || null,
        { id: row.id, date: row.date, customer_id: row.customer_id || null, visible: true },
        { type: 'customer', id: row.customer_id, visible: options.customerVisible === true }
    ) : null;
    return {
        id: `booking:${bucket}:${row.id}`,
        bucket,
        sourceType: 'booking',
        sourceId: String(row.id),
        taskId: null,
        leadId: row.lead_id || null,
        customerId: row.customer_id || null,
        bookingId: row.id,
        title: row.label || row.group_name || row.customer_name || `Бронювання ${row.id}`,
        subtitle: [row.program_name, row.room, row.time ? String(row.time).slice(0, 5) : null].filter(Boolean).join(' · ') || null,
        dueAt,
        priority: options.priority || (latePreliminary ? 'critical' : (dateValue(row.date) === options.today ? 'high' : 'normal')),
        confidence: 'exact',
        actionLabel: options.actionLabel || 'Відкрити таймлайн',
        href: `/?date=${encodeURIComponent(dateValue(row.date))}&highlight=${encodeURIComponent(row.id)}`,
        why: options.why || null,
        meta: {
            status: row.status || null,
            signal: options.signal || bucket,
            exactHref: `/?date=${encodeURIComponent(dateValue(row.date))}&highlight=${encodeURIComponent(row.id)}`,
            canConfirmInline: options.canConfirmInline === true,
            confirmationWindow: options.confirmationWindow || null,
            riskClass: latePreliminary ? 'late_preliminary' : (options.riskClass || bucket),
            latePreliminary,
            minutesUntilStart,
            bookingVisibilityScope: options.bookingVisibilityScope || null,
            bookingVisibilityClassification: options.bookingVisibilityClassification || null,
            linkedRouteParity: {
                lead: leadRoute ? {
                    href: leadRoute.href,
                    routeKind: leadRoute.routeKind,
                    reason: leadRoute.reason
                } : null,
                customer: customerRoute ? {
                    href: customerRoute.href,
                    routeKind: customerRoute.routeKind,
                    reason: customerRoute.reason
                } : null
            }
        }
    };
}

async function source(pool, warnings, name, fn) {
    try {
        return await fn();
    } catch (err) {
        warnings.push({ source: name, error: err.message });
        return [];
    }
}

async function loadTaskBucket(pool, user, bucket, whereSql, whereParams, limit, signal) {
    const params = [...whereParams];
    const visibility = buildTaskVisibility(user, params, 't');
    const bookingVisibility = getVisibleBookingScope(user, params, 'sb');
    const limitRef = pushParam(params, limit);
    const query = `
        SELECT t.id, t.title, t.description, t.status, t.priority, t.deadline, t.date,
               t.scheduled_start_at, t.scheduled_end_at, t.schedule_slot, t.schedule_mode,
               t.schedule_status, t.schedule_meta, t.schedule_proposal, t.missed_at,
               t.missed_processed_at, t.effort_minutes, t.created_by_user_id,
               t.category, t.assigned_to, t.owner, t.owner_user_id, t.version, t.updated_at,
               ou.name AS owner_name, ou.username AS owner_username,
               t.source_type AS task_source_type,
               t.source_id AS task_source_id, t.created_at,
               sl.id AS linked_lead_id,
               sb.id AS linked_booking_id, sb.date AS linked_booking_date,
               CASE WHEN sb.id IS NULL THEN false ELSE true END AS linked_booking_visible,
               sb.customer_id AS linked_customer_id,
               rcm.conversation_id AS linked_conversation_id
        FROM tasks t
        LEFT JOIN users ou ON ou.id = t.owner_user_id
        LEFT JOIN leads sl ON t.source_type = 'lead' AND t.source_id = sl.id::text
        LEFT JOIN bookings sb ON t.source_type = 'booking' AND t.source_id = sb.id::text
            AND ${bookingVisibility.condition}
        LEFT JOIN conversation_messages rcm ON t.source_type = 'conversation_reply' AND t.source_id = rcm.id::text
        WHERE ${ACTIVE_TASK_STATUS_SQL}
          ${visibility}
          AND (${whereSql})
        ORDER BY
          ${canonicalTaskOrderSql('t')},
          CASE COALESCE(t.priority, 'normal') WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
          t.created_at DESC
        LIMIT ${limitRef}
    `;
    const result = await pool.query(query, params);
    return result.rows.map(row => taskItem(row, bucket, { actor: user, signal, canExecute: true }));
}

function compareItems(a, b) {
    const aTime = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
    const bTime = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
    const safeATime = Number.isNaN(aTime) ? Number.MAX_SAFE_INTEGER : aTime;
    const safeBTime = Number.isNaN(bTime) ? Number.MAX_SAFE_INTEGER : bTime;
    if (safeATime !== safeBTime) return safeATime - safeBTime;
    return (PRIORITY_WEIGHT[a.priority] ?? 9) - (PRIORITY_WEIGHT[b.priority] ?? 9);
}

const EXECUTION_MODEL = 'reply_first_execution_engine_v6';

function routeOutExecution(item, reason, depth = 'route_out_only') {
    return {
        model: EXECUTION_MODEL,
        depth,
        inline: false,
        routeOutOnly: true,
        autoAdvance: 'never_on_route_out',
        actions: [
            {
                type: 'open_exact_context',
                label: item?.actionLabel || 'Open exact context',
                href: item?.meta?.exactHref || item?.href || null,
                durableMutation: false
            }
        ],
        unavailableReason: reason
    };
}

function executionForItem(item) {
    if (item?.bucket === 'waiting_reply') {
        const isOverdue = item.meta?.replySlaState === REPLY_SLA_STATES.OVERDUE;
        const hasEscalation = Boolean(item.meta?.replyEscalationTaskId);
        return {
            model: EXECUTION_MODEL,
            depth: 'full_reply',
            inline: true,
            routeOutOnly: false,
            autoAdvance: 'after_durable_mutation_refetch',
            actions: [
                {
                    type: 'open_exact_context',
                    label: 'Open Omni context',
                    href: item.meta?.exactHref || item.href || null,
                    durableMutation: false
                },
                {
                    type: 'reply_reassign_owner',
                    label: 'Reassign reply owner',
                    durableMutation: true,
                    canonicalField: 'conversations.reply_owner_user_id'
                },
                {
                    type: 'reply_snooze_sla',
                    label: 'Snooze reply SLA',
                    durableMutation: true,
                    canonicalField: 'conversations.reply_sla_at'
                },
                {
                    type: 'reply_clear_expectation',
                    label: 'Clear reply expectation',
                    durableMutation: true,
                    canonicalField: 'conversations.reply_expected'
                },
                {
                    type: hasEscalation ? 'open_reply_escalation' : 'reply_escalate_overdue',
                    label: hasEscalation ? 'Open reply escalation' : 'Escalate overdue reply',
                    href: item.meta?.replyEscalationHref || null,
                    enabled: hasEscalation || isOverdue,
                    durableMutation: !hasEscalation,
                    canonicalField: 'tasks.source_type=conversation_reply',
                    unavailableReason: isOverdue ? null : 'Reply escalation is only available for overdue waiting replies.'
                }
            ],
            unavailableReason: null
        };
    }

    if (item?.sourceType === 'task') {
        if (item.meta?.canTaskExecute) {
            return {
                model: 'task_execution_truth_v2',
                depth: 'limited_task_inline',
                inline: true,
                routeOutOnly: false,
                autoAdvance: 'after_durable_mutation_refetch',
                actions: [
                    {
                        type: 'open_exact_context',
                        label: item?.actionLabel || 'Open task context',
                        href: item?.meta?.exactHref || item?.href || null,
                        durableMutation: false
                    },
                    {
                        type: 'task_mark_done',
                        label: 'Mark task done',
                        durableMutation: true,
                        canonicalField: 'tasks.status'
                    },
                    {
                        type: 'task_reassign_owner',
                        label: 'Reassign task owner',
                        durableMutation: true,
                        canonicalField: 'tasks.owner_user_id'
                    },
                    {
                        type: 'task_reschedule',
                        label: 'Task deadline +24h',
                        durableMutation: true,
                        canonicalField: 'tasks.deadline'
                    }
                ],
                unavailableReason: item.meta?.ownerState === 'legacy_unknown_owner'
                    ? 'Task has legacy string ownership; inline execution is allowed through object visibility, and reassignment will create typed owner truth.'
                    : null
            };
        }
        return routeOutExecution(
            item,
            item.meta?.taskExecutionUnavailableReason || 'Task inline execution is unavailable until task object visibility is proven.',
            'limited_task_route_out'
        );
    }

    if (item?.bucket === 'callback_due') {
        return routeOutExecution(item, 'Callback completion/defer remains route-out only; follow-up state is not a shared queue execution outcome yet.');
    }

    if (item?.bucket === 'needs_confirmation') {
        return {
            model: 'confirmation_event_risk_ops_v1',
            depth: item.meta?.latePreliminary ? 'late_preliminary_inline_confirm' : 'needs_confirmation_inline_confirm',
            inline: true,
            routeOutOnly: false,
            autoAdvance: 'after_durable_mutation_refetch',
            actions: [
                {
                    type: 'open_exact_context',
                    label: item?.actionLabel || 'Open booking context',
                    href: item?.meta?.exactHref || item?.href || null,
                    durableMutation: false
                },
                {
                    type: 'booking_confirm',
                    label: item.meta?.latePreliminary ? 'Confirm critical preliminary booking' : 'Confirm booking',
                    durableMutation: true,
                    canonicalField: 'bookings.status/confirmed_at/confirmed_by',
                    endpoint: '/api/bookings/:id/confirm'
                }
            ],
            unavailableReason: null
        };
    }

    if (item?.bucket === 'event_soon') {
        return routeOutExecution(item, 'Event-soon items are review/context signals, not execution outcomes in v6.', 'review_route_out');
    }

    return routeOutExecution(item, 'No bucket-specific durable execution action is defined for this queue item.');
}

function attachExecutionRails(bucket) {
    return {
        ...bucket,
        items: (bucket.items || []).map(item => ({
            ...item,
            execution: executionForItem(item)
        }))
    };
}

function makeBucketMap() {
    return BUCKETS.reduce((acc, bucket) => {
        acc[bucket.key] = { ...bucket, count: 0, items: [] };
        return acc;
    }, {});
}

async function buildWorkQueue({
    pool,
    user,
    limit = 8,
    today = null,
    replyScope = 'all',
    replySla = 'all',
    replyOwner = 'all',
    replyEscalation = 'all',
    now = new Date()
} = {}) {
    if (!pool || typeof pool.query !== 'function') {
        throw new Error('pool with query() is required');
    }
    const safeLimit = Math.max(1, Math.min(parseInt(limit, 10) || 8, 20));
    const todayStr = today || getKyivDateStr();
    const tomorrowStr = addDays(todayStr, 1);
    const eventSoonStr = addDays(todayStr, 7);
    const warnings = [];
    const bucketMap = makeBucketMap();
    const replyBacklogScope = normalizeReplyBacklogScope(replyScope);
    const replySlaFilter = normalizeReplySlaFilter(replySla);
    const replyOwnerFilter = normalizeReplyOwnerFilter(replyOwner);
    const replyEscalationFilter = normalizeReplyEscalationFilter(replyEscalation);
    const bookingScopeMeta = getVisibleBookingScope(user, [], 'b');

    const overdue = await source(pool, warnings, 'tasks_overdue', () => loadTaskBucket(
        pool,
        user,
        'overdue',
        "(t.scheduled_end_at IS NOT NULL AND t.scheduled_end_at < NOW()) OR (t.scheduled_end_at IS NULL AND t.deadline IS NOT NULL AND t.deadline < NOW()) OR (t.scheduled_end_at IS NULL AND t.deadline IS NULL AND LEFT(COALESCE(t.date, ''), 10) < $1)",
        [todayStr],
        safeLimit,
        'task_due_overdue'
    ));

    const todayTasks = await source(pool, warnings, 'tasks_today', () => loadTaskBucket(
        pool,
        user,
        'today',
        "(t.scheduled_start_at IS NOT NULL AND (t.scheduled_start_at AT TIME ZONE 'Europe/Kyiv')::date = $1::date) OR (t.scheduled_start_at IS NULL AND t.deadline IS NOT NULL AND t.deadline >= NOW() AND t.deadline::date = $1::date) OR (t.scheduled_start_at IS NULL AND t.deadline IS NULL AND LEFT(COALESCE(t.date, ''), 10) = $1)",
        [todayStr],
        safeLimit,
        'task_due_today'
    ));

    const tomorrowTasks = await source(pool, warnings, 'tasks_tomorrow', () => loadTaskBucket(
        pool,
        user,
        'tomorrow',
        "(t.scheduled_start_at IS NOT NULL AND (t.scheduled_start_at AT TIME ZONE 'Europe/Kyiv')::date = $1::date) OR (t.scheduled_start_at IS NULL AND t.deadline IS NOT NULL AND t.deadline::date = $1::date) OR (t.scheduled_start_at IS NULL AND t.deadline IS NULL AND LEFT(COALESCE(t.date, ''), 10) = $1)",
        [tomorrowStr],
        safeLimit,
        'task_due_tomorrow'
    ));

    const callbackDue = await source(pool, warnings, 'lead_followups', async () => {
        const result = await pool.query(`
            SELECT li.id AS interaction_id, li.lead_id, li.type, li.summary, li.details,
                   li.follow_up_date AS due_at, l.client_name, l.phone, l.pipeline_stage,
                   l.assigned_to, l.booking_id, u.name AS assigned_name
            FROM lead_interactions li
            JOIN leads l ON l.id = li.lead_id
            LEFT JOIN users u ON u.id = l.assigned_to
            WHERE li.follow_up_date IS NOT NULL
              AND COALESCE(li.follow_up_done, false) = false
              AND li.follow_up_date::date <= $1::date
              AND COALESCE(l.pipeline_stage, 'new') <> ALL($2::text[])
            ORDER BY li.follow_up_date ASC, li.created_at DESC
            LIMIT $3
        `, [tomorrowStr, CLOSED_LEAD_STAGES, safeLimit]);
        return result.rows.map(row => leadItem(row, 'callback_due', {
            sourceType: 'lead_interaction',
            source_id: row.interaction_id,
            title: `Передзвонити: ${leadTitle(row)}`,
            subtitle: row.summary || row.details || row.phone || null,
            signal: 'lead_interactions.follow_up_date',
            confidence: 'exact',
            priority: dateValue(row.due_at) <= todayStr ? 'high' : 'normal'
        }));
    });

    const waitingReply = await source(pool, warnings, 'conversation_reply_expectations', async () => {
        const params = [];
        const replyScopeFilter = buildReplyBacklogScopeFilter(replyBacklogScope, user, params, 'c');
        const replyStateFilter = buildReplyBacklogStateFilter({
            sla: replySlaFilter,
            owner: replyOwnerFilter,
            escalation: replyEscalationFilter
        }, 'c', 'rt');
        const limitRef = pushParam(params, safeLimit);
        const result = await pool.query(`
            SELECT c.id AS conversation_id, c.channel, c.customer_name, c.customer_phone,
                   c.customer_id, c.assigned_to, c.reply_expected, c.awaiting_reply_since,
                   c.reply_expected_message_id, c.reply_owner, c.reply_owner_user_id, c.reply_sla_at,
                   c.last_inbound_at, c.last_outbound_at,
                   COALESCE(c.reply_sla_at, c.awaiting_reply_since) AS due_at,
                   cm.delivery_status, cm.delivery_error, cm.failed_at,
                   rt.id AS reply_escalation_task_id,
                   cust.lead_id
            FROM conversations c
            LEFT JOIN conversation_messages cm ON cm.id = c.reply_expected_message_id
            LEFT JOIN tasks rt
              ON rt.source_type = 'conversation_reply'
             AND rt.source_id = c.reply_expected_message_id::text
             AND COALESCE(rt.status, 'todo') NOT IN ('done','cancelled','archived')
            LEFT JOIN customers cust ON cust.id = c.customer_id
            WHERE c.reply_expected IS TRUE
              AND c.awaiting_reply_since IS NOT NULL
              AND COALESCE(c.status, 'open') NOT IN ('closed', 'spam')
              AND (c.last_inbound_at IS NULL OR c.last_inbound_at <= c.awaiting_reply_since)
              AND COALESCE(cm.delivery_status, '') NOT IN ('failed', 'later_failed')
              ${replyScopeFilter}
              ${replyStateFilter}
            ORDER BY
              CASE WHEN c.reply_sla_at IS NULL THEN 1 ELSE 0 END,
              COALESCE(c.reply_sla_at, c.awaiting_reply_since) ASC
            LIMIT ${limitRef}
        `, params);
        return result.rows.map(row => conversationItem(row, 'waiting_reply'));
    });

    const needsConfirmation = await source(pool, warnings, 'bookings_confirmation', async () => {
        const params = [todayStr, tomorrowStr];
        const bookingVisibility = getVisibleBookingScope(user, params, 'b');
        const limitRef = pushParam(params, safeLimit);
        const result = await pool.query(`
            SELECT b.id, b.date, b.time, b.label, b.group_name, b.program_name, b.room,
                   b.status, b.customer_id, c.lead_id
            FROM bookings b
            LEFT JOIN customers c ON c.id = b.customer_id
            WHERE LEFT(COALESCE(b.date, ''), 10) >= $1
              AND LEFT(COALESCE(b.date, ''), 10) <= $2
              AND b.status = 'preliminary'
              AND NULLIF(COALESCE(b.linked_to, ''), '') IS NULL
              ${bookingVisibility.sql}
            ORDER BY b.date ASC, b.time ASC NULLS LAST
            LIMIT ${limitRef}
        `, params);
        return result.rows.map(row => {
            const minutesUntilStart = minutesUntilBookingStart(row, now);
            const latePreliminary = isLatePreliminaryBooking(row, now);
            return bookingItem(row, 'needs_confirmation', {
                actor: user,
                today: todayStr,
                actionLabel: 'Підтвердити бронювання',
                signal: 'bookings.status_preliminary',
                priority: latePreliminary ? 'critical' : (dateValue(row.date) === todayStr ? 'high' : 'normal'),
                canConfirmInline: true,
                confirmationWindow: 'today_tomorrow_preliminary',
                latePreliminary,
                minutesUntilStart,
                bookingVisibilityScope: bookingVisibility.scopeSource,
                bookingVisibilityClassification: bookingVisibility.classification,
                why: latePreliminary
                    ? 'Booking is preliminary and starts in the next 2 hours.'
                    : `Booking is preliminary and event is ${dateValue(row.date) === todayStr ? 'today' : 'tomorrow'}.`
            });
        });
    });

    const eventSoon = await source(pool, warnings, 'leads_event_soon', async () => {
        const result = await pool.query(`
            SELECT l.id, l.client_name, l.phone, l.event_date AS due_at,
                   l.pipeline_stage, l.assigned_to, l.booking_id, u.name AS assigned_name,
                   p.label AS program_name
            FROM leads l
            LEFT JOIN users u ON u.id = l.assigned_to
            LEFT JOIN products p ON p.id = l.program_id
            WHERE l.event_date IS NOT NULL
              AND l.event_date::date >= $1::date
              AND l.event_date::date <= $2::date
              AND COALESCE(l.pipeline_stage, 'new') <> ALL($3::text[])
            ORDER BY l.event_date ASC, l.updated_at DESC
            LIMIT $4
        `, [todayStr, eventSoonStr, CLOSED_LEAD_STAGES, safeLimit]);
        return result.rows.map(row => leadItem(row, 'event_soon', {
            title: `Подія скоро: ${leadTitle(row)}`,
            subtitle: [row.program_name, row.phone].filter(Boolean).join(' · ') || null,
            signal: 'leads.event_date',
            confidence: 'durable',
            priority: dateValue(row.due_at) <= tomorrowStr ? 'high' : 'normal'
        }));
    });

    const funnelInsights = await source(pool, warnings, 'leads_funnel_summary', async () => {
        const result = await pool.query(`
            SELECT COALESCE(NULLIF(l.pipeline_stage, ''), 'new') AS stage,
                   COUNT(*)::int AS total,
                   COUNT(*) FILTER (
                       WHERE COALESCE(l.last_contact_at, l.created_at) < NOW() - INTERVAL '48 hours'
                   )::int AS waiting_action,
                   MIN(COALESCE(l.last_contact_at, l.created_at)) AS oldest_touch_at
            FROM leads l
            WHERE COALESCE(l.pipeline_stage, 'new') <> ALL($1::text[])
            GROUP BY COALESCE(NULLIF(l.pipeline_stage, ''), 'new')
            ORDER BY waiting_action DESC, total DESC, stage ASC
            LIMIT 8
        `, [CLOSED_LEAD_STAGES]);
        return normalizeLeadFunnelInsights(result.rows);
    });

    const tomorrowBookings = await source(pool, warnings, 'bookings_tomorrow', async () => {
        const params = [tomorrowStr];
        const bookingVisibility = getVisibleBookingScope(user, params, 'b');
        const limitRef = pushParam(params, safeLimit);
        const result = await pool.query(`
            SELECT b.id, b.date, b.time, b.label, b.group_name, b.program_name, b.room,
                   b.status, b.customer_id, c.lead_id
            FROM bookings b
            LEFT JOIN customers c ON c.id = b.customer_id
            WHERE LEFT(COALESCE(b.date, ''), 10) = $1
              AND b.status IN ('confirmed', 'preliminary')
              AND NULLIF(COALESCE(b.linked_to, ''), '') IS NULL
              ${bookingVisibility.sql}
            ORDER BY b.time ASC NULLS LAST
            LIMIT ${limitRef}
        `, params);
        return result.rows.map(row => bookingItem(row, 'tomorrow', {
            actor: user,
            today: todayStr,
            actionLabel: 'Перевірити підготовку',
            signal: 'bookings.date_tomorrow',
            priority: row.status === 'preliminary' ? 'high' : 'normal',
            bookingVisibilityScope: bookingVisibility.scopeSource,
            bookingVisibilityClassification: bookingVisibility.classification
        }));
    });

    const allItems = [
        ...overdue,
        ...todayTasks,
        ...tomorrowTasks,
        ...tomorrowBookings,
        ...callbackDue,
        ...waitingReply,
        ...needsConfirmation,
        ...eventSoon
    ];

    for (const item of allItems) {
        if (!bucketMap[item.bucket]) continue;
        bucketMap[item.bucket].items.push(item);
    }

    for (const bucket of Object.values(bucketMap)) {
        bucket.items.sort(compareItems);
        bucket.count = bucket.items.length;
    }
    const queueBuckets = BUCKETS.map(bucket => attachExecutionRails(bucketMap[bucket.key]));
    const enrichedQueue = enrichQueueBuckets(queueBuckets, {
        today: todayStr,
        tomorrow: tomorrowStr,
        eventSoonUntil: eventSoonStr
    });

    return {
        generatedAt: new Date().toISOString(),
        timezone: 'Europe/Kyiv',
        date: {
            today: todayStr,
            tomorrow: tomorrowStr,
            eventSoonUntil: eventSoonStr
        },
        buckets: enrichedQueue.buckets,
        items: enrichedQueue.items,
        meta: {
            canonicalBuckets: BUCKETS.map(bucket => bucket.key),
            heuristicBuckets: [],
            omittedBuckets: [],
            funnelInsights: Array.isArray(funnelInsights) ? normalizeLeadFunnelInsights([]) : funnelInsights,
            intelligence: enrichedQueue.summary,
            bookingVisibility: {
                visibleScopeOnly: true,
                scopeSource: bookingScopeMeta.scopeSource,
                classification: bookingScopeMeta.classification,
                reason: bookingScopeMeta.reason,
                denialSemantics: 'hidden-bookings-are-absent-from-booking-derived-queue-items',
                promotedDurableScopes: ['staff-host-assignment'],
                missingDurableScopes: ['team', 'line', 'location']
            },
            replyBacklog: {
                scope: replyBacklogScope,
                availableScopes: REPLY_BACKLOG_SCOPES,
                filters: {
                    sla: replySlaFilter,
                    owner: replyOwnerFilter,
                    escalation: replyEscalationFilter
                },
                availableFilters: {
                    sla: REPLY_SLA_FILTERS,
                    owner: REPLY_OWNER_FILTERS,
                    escalation: REPLY_ESCALATION_FILTERS
                },
                presets: [
                    { key: 'all', label: 'All reply backlog', scope: 'all', sla: 'all', owner: 'all', escalation: 'all' },
                    { key: 'mine_overdue', label: 'My overdue replies', scope: 'mine', sla: 'overdue', owner: 'all', escalation: 'all' },
                    { key: 'team_overdue', label: 'Team overdue replies', scope: 'team', sla: 'overdue', owner: 'all', escalation: 'all' },
                    { key: 'unassigned', label: 'Unassigned replies', scope: 'all', sla: 'all', owner: 'without_owner', escalation: 'all' },
                    { key: 'escalated', label: 'Escalated replies', scope: 'all', sla: 'all', owner: 'all', escalation: 'escalated' }
                ],
                canonicalOwnerField: 'conversations.reply_owner_user_id',
                displayOwnerField: 'conversations.reply_owner',
                labelFiltering: false,
                nullOwnerBehavior: replyBacklogScope === 'mine' ? 'excluded' : 'included_if_visible',
                teamSemantics: 'manager_visible_non_mine'
            },
            warnings
        }
    };
}

module.exports = {
    BUCKETS,
    REPLY_BACKLOG_SCOPES,
    REPLY_SLA_FILTERS,
    REPLY_OWNER_FILTERS,
    REPLY_ESCALATION_FILTERS,
    normalizeReplyBacklogScope,
    normalizeReplySlaFilter,
    normalizeReplyOwnerFilter,
    normalizeReplyEscalationFilter,
    EXECUTION_MODEL,
    executionForItem,
    buildWorkQueue,
    addDays,
    minutesUntilBookingStart,
    isLatePreliminaryBooking
};

'use strict';

const PRIORITY_BANDS = Object.freeze({
    CRITICAL: 'critical',
    ACTION_TODAY: 'action_today',
    WATCH: 'watch',
    SUGGESTED: 'suggested'
});

const INTELLIGENCE_MODEL = 'bucket_aware_priority_bands_v1';

function dateOnly(value) {
    if (!value) return null;
    const raw = String(value);
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function isDueOnOrBefore(item, day) {
    const due = dateOnly(item?.dueAt);
    return Boolean(due && day && due <= day);
}

function isDueAfter(item, day) {
    const due = dateOnly(item?.dueAt);
    return Boolean(due && day && due > day);
}

function baseAction(type, label, href) {
    return {
        type,
        label,
        href: href || null,
        bucketScoped: true
    };
}

function confidenceFor(item, fallback = 'medium') {
    if (item?.bucket === 'waiting_reply') return 'high';
    if (item?.confidence === 'suggested') return 'low';
    if (item?.confidence === 'exact' || item?.confidence === 'durable') return fallback;
    return fallback;
}

function unique(values) {
    return Array.from(new Set(values.filter(Boolean)));
}

function waitingReplyIntelligence(item) {
    const meta = item.meta || {};
    const riskTypes = ['reply_expected'];
    const why = [
        `Explicit reply expectation is active from conversations.reply_expected; waiting since ${meta.awaitingReplySince || meta.waitingSince || 'unknown'}.`
    ];
    let priorityBand = PRIORITY_BANDS.WATCH;
    let action = baseAction('reply_now', 'Open Omni and reply', meta.exactHref || item.href);

    if (meta.replySlaState === 'overdue') {
        priorityBand = PRIORITY_BANDS.CRITICAL;
        riskTypes.push('reply_sla_overdue');
        why.push(`reply_sla_at is overdue (${meta.replySlaAt || 'no timestamp available'}).`);
    } else if (meta.replySlaState === 'due_soon') {
        riskTypes.push('reply_sla_due_soon');
        why.push(`reply_sla_at is due soon (${meta.replySlaAt || 'no timestamp available'}).`);
    } else if (meta.replySlaState === 'on_track') {
        riskTypes.push('reply_sla_on_track');
        why.push(`reply_sla_at is still on track (${meta.replySlaAt || 'no timestamp available'}).`);
    } else {
        riskTypes.push('reply_sla_missing');
        why.push('No reply_sla_at is present, so overdue severity is not inferred.');
    }

    if (meta.replyEscalationTaskId) {
        priorityBand = PRIORITY_BANDS.CRITICAL;
        riskTypes.push('reply_escalated');
        why.push(`A linked conversation_reply escalation task exists (${meta.replyEscalationTaskId}).`);
        action = baseAction('open_reply_escalation', 'Open reply escalation context', meta.replyEscalationHref || meta.exactHref || item.href);
    }

    if (!meta.replyOwnerUserId) {
        riskTypes.push('reply_unassigned');
        why.push('reply_owner_user_id is empty, so ownership is not typed yet.');
        if (priorityBand !== PRIORITY_BANDS.CRITICAL) {
            priorityBand = PRIORITY_BANDS.ACTION_TODAY;
        }
    }

    return {
        priorityBand,
        riskTypes: unique(riskTypes),
        recommendedAction: action,
        why,
        confidence: 'high',
        depth: 'full',
        sourceFields: unique([
            'conversations.reply_expected',
            'conversations.awaiting_reply_since',
            'conversations.reply_sla_at',
            'conversations.reply_owner_user_id',
            'tasks.source_type=conversation_reply',
            'conversation_messages.delivery_status'
        ])
    };
}

function taskIntelligence(item, options) {
    const signal = item.meta?.signal || '';
    const isOverdue = item.bucket === 'overdue';
    const isToday = item.bucket === 'today' || isDueOnOrBefore(item, options.today);
    const priorityBand = isOverdue
        ? PRIORITY_BANDS.CRITICAL
        : (isToday ? PRIORITY_BANDS.ACTION_TODAY : PRIORITY_BANDS.WATCH);
    const riskType = isOverdue
        ? 'task_overdue'
        : (item.bucket === 'tomorrow' ? 'task_due_tomorrow' : 'task_due_today');

    return {
        priorityBand,
        riskTypes: unique([riskType, item.meta?.category ? `task_category_${item.meta.category}` : null]),
        recommendedAction: baseAction('open_task_or_case', item.actionLabel || 'Open task context', item.href),
        why: [
            `Task item is in bucket ${item.bucket} from ${signal || 'deadline/date'} and remains active.`,
            item.meta?.assignedTo
                ? `Task assignment is display-based (${item.meta.assignedTo}), so owner intelligence is limited.`
                : 'No task assignee/owner label is available.'
        ],
        confidence: confidenceFor(item, 'medium'),
        depth: 'limited',
        sourceFields: unique(['tasks.deadline', 'tasks.date', 'tasks.status', 'tasks.priority', 'tasks.source_type', 'tasks.source_id'])
    };
}

function callbackDueIntelligence(item, options) {
    const dueToday = isDueOnOrBefore(item, options.today);
    return {
        priorityBand: dueToday ? PRIORITY_BANDS.ACTION_TODAY : PRIORITY_BANDS.WATCH,
        riskTypes: unique(['callback_due', dueToday ? 'callback_due_today' : 'callback_due_soon']),
        recommendedAction: baseAction('open_lead_for_callback', 'Open lead and call client', item.href),
        why: [
            `lead_interactions.follow_up_date placed this item in callback_due (${item.dueAt || 'no due timestamp'}).`,
            'This is callback/follow-up work, not canonical waiting_reply.'
        ],
        confidence: 'medium',
        depth: 'limited',
        sourceFields: ['lead_interactions.follow_up_date', 'lead_interactions.follow_up_done', 'leads.pipeline_stage']
    };
}

function confirmationIntelligence(item, options) {
    const dueToday = isDueOnOrBefore(item, options.today);
    return {
        priorityBand: dueToday ? PRIORITY_BANDS.CRITICAL : PRIORITY_BANDS.ACTION_TODAY,
        riskTypes: unique(['booking_needs_confirmation', dueToday ? 'confirmation_due_today' : 'confirmation_due_soon']),
        recommendedAction: baseAction('open_booking_context', item.actionLabel || 'Open booking context', item.href),
        why: [
            `Booking is preliminary and in the confirmation window (${item.dueAt || 'no due timestamp'}).`,
            'Queue can route to booking context; inline confirmation semantics remain separate.'
        ],
        confidence: 'medium',
        depth: 'limited',
        sourceFields: ['bookings.status', 'bookings.date', 'bookings.time', 'bookings.linked_to']
    };
}

function eventSoonIntelligence(item, options) {
    const soon = isDueOnOrBefore(item, options.tomorrow);
    return {
        priorityBand: soon ? PRIORITY_BANDS.ACTION_TODAY : PRIORITY_BANDS.WATCH,
        riskTypes: unique(['event_soon', soon ? 'event_near_window' : 'event_watch_window']),
        recommendedAction: baseAction('review_event_context', 'Review event context', item.href),
        why: [
            `leads.event_date is inside the queue event window (${item.dueAt || 'no due timestamp'}).`,
            'This flags timing pressure, not final readiness or confirmation certainty.'
        ],
        confidence: 'medium',
        depth: 'limited',
        sourceFields: ['leads.event_date', 'leads.pipeline_stage']
    };
}

function idleLeadIntelligence(item) {
    return {
        priorityBand: PRIORITY_BANDS.SUGGESTED,
        riskTypes: ['lead_idle_heuristic'],
        recommendedAction: baseAction('review_lead', 'Review lead context', item.href),
        why: [
            'Lead appears idle from COALESCE(leads.last_contact_at, leads.created_at).',
            'This is a queue heuristic and must not outrank canonical overdue reply or task pressure.'
        ],
        confidence: 'low',
        depth: 'summary_only',
        sourceFields: ['leads.last_contact_at', 'leads.created_at']
    };
}

function fallbackIntelligence(item) {
    return {
        priorityBand: item?.confidence === 'suggested' ? PRIORITY_BANDS.SUGGESTED : PRIORITY_BANDS.WATCH,
        riskTypes: unique([item?.bucket ? `${item.bucket}_signal` : 'queue_signal']),
        recommendedAction: baseAction('open_context', item?.actionLabel || 'Open context', item?.href),
        why: [
            `Queue item came from ${item?.meta?.signal || item?.bucket || 'available queue signal'}.`,
            'No stronger bucket-specific intelligence rule is defined for this item.'
        ],
        confidence: confidenceFor(item, 'medium'),
        depth: item?.confidence === 'suggested' ? 'summary_only' : 'limited',
        sourceFields: unique([item?.meta?.signal || item?.bucket || 'queue'])
    };
}

function deriveItemIntelligence(item, options = {}) {
    if (!item || typeof item !== 'object') return fallbackIntelligence(item);
    if (item.bucket === 'waiting_reply') return waitingReplyIntelligence(item);
    if (item.sourceType === 'task' || ['overdue', 'today'].includes(item.bucket)) return taskIntelligence(item, options);
    if (item.bucket === 'tomorrow' && item.sourceType === 'task') return taskIntelligence(item, options);
    if (item.bucket === 'callback_due') return callbackDueIntelligence(item, options);
    if (item.bucket === 'needs_confirmation') return confirmationIntelligence(item, options);
    if (item.bucket === 'event_soon') return eventSoonIntelligence(item, options);
    if (item.bucket === 'idle_lead') return idleLeadIntelligence(item);
    if (item.bucket === 'tomorrow' && item.sourceType === 'booking') {
        return {
            ...confirmationIntelligence(item, options),
            priorityBand: PRIORITY_BANDS.WATCH,
            riskTypes: ['tomorrow_booking_prep'],
            recommendedAction: baseAction('review_tomorrow_booking', item.actionLabel || 'Review tomorrow booking', item.href),
            why: [
                `Booking is visible in tomorrow prep from ${item.meta?.signal || 'bookings.date_tomorrow'}.`,
                'This is preparation pressure, not a confirmation failure by itself.'
            ],
            sourceFields: ['bookings.date', 'bookings.status', 'bookings.time']
        };
    }
    return fallbackIntelligence(item);
}

function enrichItem(item, options = {}) {
    const intelligence = deriveItemIntelligence(item, options);
    return {
        ...item,
        intelligence: {
            model: INTELLIGENCE_MODEL,
            globalScore: false,
            ...intelligence
        }
    };
}

function increment(map, key) {
    if (!key) return;
    map.set(key, (map.get(key) || 0) + 1);
}

function buildBottlenecks(items) {
    const bottlenecks = [];
    const replyOwnerMap = new Map();
    let unassignedUrgentReplies = 0;
    let escalatedReplies = 0;
    let visibleOverdueTasks = 0;

    for (const item of items) {
        const intel = item.intelligence || {};
        const meta = item.meta || {};
        if (item.bucket === 'waiting_reply') {
            const urgent = ['critical', 'action_today'].includes(intel.priorityBand);
            if (meta.replyEscalationTaskId) escalatedReplies += 1;
            if (urgent && !meta.replyOwnerUserId) unassignedUrgentReplies += 1;
            if (urgent && meta.replyOwnerUserId) {
                const key = String(meta.replyOwnerUserId);
                const existing = replyOwnerMap.get(key) || {
                    type: 'reply_pressure_by_owner',
                    ownerUserId: meta.replyOwnerUserId,
                    label: meta.assignedTo || `User #${meta.replyOwnerUserId}`,
                    count: 0,
                    confidence: 'high'
                };
                existing.count += 1;
                replyOwnerMap.set(key, existing);
            }
        }
        if (item.bucket === 'overdue' && item.sourceType === 'task') visibleOverdueTasks += 1;
    }

    if (unassignedUrgentReplies > 0) {
        bottlenecks.push({
            type: 'unassigned_urgent_replies',
            label: 'Unassigned urgent replies',
            count: unassignedUrgentReplies,
            confidence: 'high'
        });
    }
    if (escalatedReplies > 0) {
        bottlenecks.push({
            type: 'escalated_replies',
            label: 'Escalated replies',
            count: escalatedReplies,
            confidence: 'high'
        });
    }
    for (const entry of replyOwnerMap.values()) {
        if (entry.count > 0) bottlenecks.push(entry);
    }
    if (visibleOverdueTasks > 0) {
        bottlenecks.push({
            type: 'visible_overdue_tasks',
            label: 'Visible overdue task pressure',
            count: visibleOverdueTasks,
            confidence: 'medium',
            caveat: 'Task ownership can still be display/string based.'
        });
    }
    return bottlenecks.sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

function buildSummary(items) {
    const bandCounts = new Map();
    const riskCounts = new Map();
    const confidenceCounts = new Map();
    const depthCounts = new Map();

    for (const item of items) {
        const intel = item.intelligence || {};
        increment(bandCounts, intel.priorityBand || PRIORITY_BANDS.WATCH);
        increment(confidenceCounts, intel.confidence || 'medium');
        increment(depthCounts, intel.depth || 'limited');
        for (const risk of intel.riskTypes || []) increment(riskCounts, risk);
    }

    const toObject = map => Object.fromEntries(map.entries());
    const topRisks = Array.from(riskCounts.entries())
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));

    return {
        model: INTELLIGENCE_MODEL,
        globalScore: false,
        source: 'visible_queue_items',
        visibleScopeOnly: true,
        hiddenDataScanned: false,
        priorityBands: toObject(bandCounts),
        confidence: toObject(confidenceCounts),
        depth: toObject(depthCounts),
        topRisks,
        bottlenecks: buildBottlenecks(items),
        weakBuckets: ['idle_lead'],
        includedBuckets: unique(items.map(item => item.bucket))
    };
}

function enrichQueueBuckets(buckets, options = {}) {
    const enrichedBuckets = (buckets || []).map(bucket => ({
        ...bucket,
        items: (bucket.items || []).map(item => enrichItem(item, options))
    }));
    const items = enrichedBuckets.flatMap(bucket => bucket.items || []);
    return {
        buckets: enrichedBuckets,
        items,
        summary: buildSummary(items)
    };
}

module.exports = {
    INTELLIGENCE_MODEL,
    PRIORITY_BANDS,
    deriveItemIntelligence,
    enrichItem,
    enrichQueueBuckets,
    buildSummary
};

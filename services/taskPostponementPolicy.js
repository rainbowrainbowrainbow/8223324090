'use strict';

const PRIORITY_RANK = Object.freeze({ low: 0, normal: 1, high: 2, urgent: 3 });

function normalizePostponementCount(value) {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function postponementAttentionLevel(value) {
    return Math.min(3, normalizePostponementCount(value));
}

function minimumPriorityForPostponement(value) {
    const level = postponementAttentionLevel(value);
    if (level >= 2) return 'urgent';
    if (level === 1) return 'high';
    return null;
}

function normalizeTaskPriority(value) {
    const priority = String(value || 'normal').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(PRIORITY_RANK, priority) ? priority : 'normal';
}

function derivePostponementPriority(value, currentPriority) {
    const count = normalizePostponementCount(value);
    const attentionLevel = postponementAttentionLevel(count);
    const priorityBefore = normalizeTaskPriority(currentPriority);
    const minimumPriority = minimumPriorityForPostponement(count);
    const priorityAfter = minimumPriority && PRIORITY_RANK[minimumPriority] > PRIORITY_RANK[priorityBefore]
        ? minimumPriority
        : priorityBefore;
    return {
        count,
        attentionLevel,
        minimumPriority,
        priorityBefore,
        priorityAfter,
        priorityEscalated: priorityAfter !== priorityBefore
    };
}

module.exports = {
    derivePostponementPriority,
    minimumPriorityForPostponement,
    normalizePostponementCount,
    normalizeTaskPriority,
    postponementAttentionLevel
};

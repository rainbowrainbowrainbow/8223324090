'use strict';

const TASK_ACTION_TYPES = Object.freeze({
    ACKNOWLEDGED: 'task_acknowledged',
    COMPLETED: 'task_completed',
    OWNER_REASSIGNED: 'task_owner_reassigned',
    RESCHEDULED: 'task_rescheduled',
    STATUS_CHANGED: 'task_status_changed',
    PRIORITY_CHANGED: 'task_priority_changed',
    SNOOZED: 'task_snoozed',
    URGENT_COMMITMENT_SET: 'task_urgent_commitment_set',
    SUBTASK_COMPLETED: 'task_subtask_completed',
    OBSERVERS_UPDATED: 'task_observers_updated',
    SCHEDULED: 'task_scheduled',
    SCHEDULE_MOVED: 'task_schedule_moved',
    SCHEDULE_MANUAL_OVERRIDE: 'task_schedule_manual_override',
    SCHEDULE_PROPOSAL_CREATED: 'task_schedule_proposal_created',
    SLOT_MISSED: 'task_slot_missed',
    DISCIPLINE_PENALTY_APPLIED: 'task_discipline_penalty_applied',
    CREATED: 'task_created',
    AI_DRAFT_COMMITTED: 'task_ai_draft_committed',
    AI_DRAFT_BUNDLE_COMMITTED: 'task_ai_draft_bundle_committed',
    COMMENTED: 'task_commented'
});

module.exports = {
    TASK_ACTION_TYPES
};

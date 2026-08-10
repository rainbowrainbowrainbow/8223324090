const crypto = require('node:crypto');

const CLASSIFIER_VERSION = 'task_stale_machine_report_v1_2026_08_10';

const TERMINAL_STATUSES = new Set(['done', 'completed', 'cancelled', 'archived']);
const PRIVATE_OR_PERSONAL = new Set(['private', 'me_only', 'personal']);
const MACHINE_CREATORS = new Set(['rule_engine', 'system', 'scheduler']);
const MACHINE_TASK_TYPES = new Set(['auto', 'auto_complete', 'recurring']);
const CANCELLED_BOOKING_STATUSES = new Set(['cancelled', 'canceled']);

function normalize(value) {
    return String(value || '').trim().toLowerCase();
}

function bool(value) {
    return value === true || value === 'true' || value === 1 || value === '1';
}

function numeric(value) {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
}

function sha256(payload) {
    return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function sortedTaskIds(rows) {
    return rows.map(row => Number(row.task_id || row.id)).filter(Number.isFinite).sort((a, b) => a - b);
}

function isTerminalOrArchived(row = {}) {
    return bool(row.archived) || row.archived_at || TERMINAL_STATUSES.has(normalize(row.task_status || row.status));
}

function isPrivateOrPersonal(row = {}) {
    return PRIVATE_OR_PERSONAL.has(normalize(row.visibility)) || PRIVATE_OR_PERSONAL.has(normalize(row.task_mode));
}

function isAiAssisted(row = {}) {
    const sourceType = normalize(row.source_type);
    const taskType = normalize(row.task_type || row.type || row.task_type_legacy);
    return sourceType === 'ai_draft'
        || sourceType === 'ai_draft_bundle'
        || taskType === 'ai_draft'
        || taskType === 'ai_draft_bundle'
        || numeric(row.ai_bundle_count) > 0;
}

function isIntegration(row = {}) {
    const sourceType = normalize(row.source_type);
    const sourceModule = normalize(row.source_module);
    const creatorClass = normalize(row.creator_class);
    return sourceType === 'hermes'
        || sourceType === 'integration'
        || sourceModule === 'hermes'
        || sourceModule === 'integration'
        || creatorClass === 'hermes'
        || creatorClass === 'integration';
}

function isAttendance(row = {}) {
    return normalize(row.source_type) === 'attendance' || normalize(row.source_module) === 'attendance';
}

function isStrictRuleEngineBooking(row = {}) {
    return normalize(row.source_type) === 'booking'
        && normalize(row.creator_class || row.created_by_normalized) === 'rule_engine'
        && MACHINE_TASK_TYPES.has(normalize(row.task_type || row.type || row.task_type_legacy))
        && numeric(row.created_by_user_id) === 0;
}

function isRecurringTemplateGenerated(row = {}) {
    const sourceType = normalize(row.source_type);
    const taskType = normalize(row.task_type || row.type || row.task_type_legacy);
    const creatorClass = normalize(row.creator_class || row.created_by_normalized);
    return (sourceType === 'recurring' || taskType === 'recurring' || bool(row.has_template_id))
        && MACHINE_CREATORS.has(creatorClass)
        && numeric(row.created_by_user_id) === 0;
}

function protectionFlags(row = {}) {
    const flags = [];
    if (numeric(row.created_by_user_id) > 0) flags.push('typed_creator');
    if (isPrivateOrPersonal(row)) flags.push('private_or_personal');
    if (normalize(row.task_status || row.status) === 'in_progress' || normalize(row.workflow_state) === 'in_progress') flags.push('in_progress');
    if (numeric(row.focus_rank) > 0 || bool(row.is_focused)) flags.push('focus');
    if (bool(row.has_future_snooze) || bool(row.has_snooze)) flags.push('snooze');
    if (bool(row.human_touched)) flags.push('human_touched');
    if (numeric(row.subtask_count) > 0) flags.push('subtasks');
    if (numeric(row.dependency_count) > 0) flags.push('dependencies');
    if (numeric(row.observer_count) > 0) flags.push('observers');
    if (isAiAssisted(row)) flags.push('ai_assisted');
    return flags;
}

function safeEvidence(row = {}) {
    return {
        status: normalize(row.task_status || row.status),
        workflowState: normalize(row.workflow_state),
        sourceType: normalize(row.source_type),
        sourceModule: normalize(row.source_module),
        taskType: normalize(row.task_type || row.type || row.task_type_legacy),
        creatorClass: normalize(row.creator_class || row.created_by_normalized || 'unknown'),
        hasTypedCreator: numeric(row.created_by_user_id) > 0,
        visibilityClass: isPrivateOrPersonal(row) ? 'private_or_personal' : 'team_or_unspecified',
        canonicalOverdue: bool(row.canonical_overdue),
        bookingFound: bool(row.booking_found),
        bookingState: normalize(row.booking_state || row.booking_status_class || row.booking_status || 'unknown'),
        bookingDateBucket: normalize(row.booking_date_bucket || 'unknown'),
        hasTemplateId: bool(row.has_template_id),
        templateFound: bool(row.template_found),
        templateActive: bool(row.template_active),
        templateContextMatch: row.template_context_match === null || row.template_context_match === undefined
            ? null
            : bool(row.template_context_match),
        protectionFlags: protectionFlags(row).sort()
    };
}

function classifyStaleMachineTask(row = {}) {
    if (isTerminalOrArchived(row) || !bool(row.active ?? true)) {
        return {
            decision: 'ignored',
            cohort: 'ignored_terminal_or_archived',
            reason: 'terminal_or_archived_tasks_are_out_of_scope'
        };
    }

    const flags = protectionFlags(row);
    const canonicalOverdue = bool(row.canonical_overdue);
    const bookingDateBucket = normalize(row.booking_date_bucket);
    const bookingStatus = normalize(row.booking_status);

    if (isAttendance(row)) {
        return {
            decision: 'protected',
            cohort: 'protected_attendance',
            reason: 'attendance_tasks_are_human_operational_records'
        };
    }

    if (isIntegration(row)) {
        return {
            decision: 'protected',
            cohort: 'protected_hermes_or_integration',
            reason: 'integration_tasks_require_source_specific_review'
        };
    }

    if (isAiAssisted(row)) {
        return {
            decision: 'protected',
            cohort: 'protected_ai_assisted',
            reason: 'ai_assisted_tasks_require_human_review'
        };
    }

    if (flags.length > 0) {
        return {
            decision: 'protected',
            cohort: 'protected_by_human_or_visibility_flags',
            reason: flags.join(',')
        };
    }

    if (!canonicalOverdue) {
        return {
            decision: 'protected',
            cohort: 'protected_current_or_future',
            reason: 'not_canonical_overdue_or_future_snoozed'
        };
    }

    if (isStrictRuleEngineBooking(row)) {
        if (!bool(row.booking_found)) {
            return {
                decision: 'protected',
                cohort: 'protected_booking_orphan',
                reason: 'booking_parent_not_found'
            };
        }

        if (bookingDateBucket === 'today_or_future') {
            return {
                decision: 'protected',
                cohort: 'protected_booking_current_or_future',
                reason: 'booking_parent_is_current_or_future'
            };
        }

        if (CANCELLED_BOOKING_STATUSES.has(bookingStatus)) {
            return {
                decision: 'report_candidate',
                cohort: 'candidate_strict_booking_cancelled',
                reason: 'strict_rule_engine_booking_cancelled',
                candidateArchiveReason: 'cleanup_candidate_strict_booking_cancelled_v1'
            };
        }

        if (bookingDateBucket === 'past') {
            return {
                decision: 'report_candidate',
                cohort: 'candidate_strict_booking_past',
                reason: 'strict_rule_engine_booking_past',
                candidateArchiveReason: 'cleanup_candidate_strict_booking_past_v1'
            };
        }
    }

    if (isRecurringTemplateGenerated(row)) {
        if (bookingDateBucket === 'today_or_future') {
            return {
                decision: 'protected',
                cohort: 'protected_recurring_current_or_future',
                reason: 'recurring_task_current_or_future'
            };
        }

        return {
            decision: 'report_candidate',
            cohort: 'candidate_recurring_template_stale',
            reason: 'template_generated_recurring_task_stale',
            candidateArchiveReason: 'cleanup_candidate_recurring_template_stale_v1'
        };
    }

    return {
        decision: 'protected',
        cohort: 'protected_unknown_or_unproven_machine_lineage',
        reason: 'unknown_or_unproven_machine_lineage'
    };
}

function buildStaleMachineReport(rows = [], options = {}) {
    const kyivToday = options.kyivToday || rows.find(row => row.kyiv_today)?.kyiv_today || null;
    const capturedAt = options.capturedAt || rows.find(row => row.captured_at)?.captured_at || new Date().toISOString();
    const grouped = new Map();

    for (const row of rows) {
        const classification = classifyStaleMachineTask(row);
        if (!grouped.has(classification.cohort)) {
            grouped.set(classification.cohort, {
                cohort: classification.cohort,
                decision: classification.decision,
                reason: classification.reason,
                candidateArchiveReason: classification.candidateArchiveReason || null,
                rows: []
            });
        }
        grouped.get(classification.cohort).rows.push({ row, classification });
    }

    const cohorts = Array.from(grouped.values())
        .sort((a, b) => a.cohort.localeCompare(b.cohort))
        .map(group => {
            const ids = sortedTaskIds(group.rows.map(item => item.row));
            const evidenceRows = group.rows
                .map(item => safeEvidence(item.row))
                .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
            return {
                cohort: group.cohort,
                decision: group.decision,
                reason: group.reason,
                candidateArchiveReason: group.candidateArchiveReason,
                count: ids.length,
                membershipChecksum: sha256({
                    classifierVersion: CLASSIFIER_VERSION,
                    kyivToday,
                    cohort: group.cohort,
                    ids
                }),
                evidenceChecksum: sha256({
                    classifierVersion: CLASSIFIER_VERSION,
                    kyivToday,
                    cohort: group.cohort,
                    rows: evidenceRows
                })
            };
        });

    const candidateTotal = cohorts
        .filter(cohort => cohort.decision === 'report_candidate')
        .reduce((sum, cohort) => sum + cohort.count, 0);
    const protectedTotal = cohorts
        .filter(cohort => cohort.decision === 'protected')
        .reduce((sum, cohort) => sum + cohort.count, 0);
    const ignoredTotal = cohorts
        .filter(cohort => cohort.decision === 'ignored')
        .reduce((sum, cohort) => sum + cohort.count, 0);

    const manifestChecksum = sha256({
        classifierVersion: CLASSIFIER_VERSION,
        kyivToday,
        cohorts: cohorts.map(cohort => ({
            cohort: cohort.cohort,
            decision: cohort.decision,
            count: cohort.count,
            membershipChecksum: cohort.membershipChecksum,
            evidenceChecksum: cohort.evidenceChecksum
        }))
    });

    return {
        classifierVersion: CLASSIFIER_VERSION,
        capturedAt,
        kyivToday,
        mode: 'report_only',
        mutationAllowed: false,
        totals: {
            considered: rows.length,
            reportCandidates: candidateTotal,
            protected: protectedTotal,
            ignored: ignoredTotal
        },
        cohorts,
        manifestChecksum
    };
}

function summaryForStdout(report = {}) {
    return {
        classifierVersion: report.classifierVersion,
        capturedAt: report.capturedAt,
        kyivToday: report.kyivToday,
        mode: report.mode,
        mutationAllowed: false,
        totals: report.totals,
        manifestChecksum: report.manifestChecksum,
        cohorts: (report.cohorts || []).map(cohort => ({
            cohort: cohort.cohort,
            decision: cohort.decision,
            count: cohort.count,
            membershipChecksum: cohort.membershipChecksum,
            evidenceChecksum: cohort.evidenceChecksum,
            candidateArchiveReason: cohort.candidateArchiveReason
        }))
    };
}

module.exports = {
    CLASSIFIER_VERSION,
    classifyStaleMachineTask,
    buildStaleMachineReport,
    summaryForStdout,
    protectionFlags,
    safeEvidence
};

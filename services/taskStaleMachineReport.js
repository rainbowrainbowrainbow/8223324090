const crypto = require('node:crypto');
const {
    BOOKING_TERMINAL_STATUSES,
    MACHINE_CREATORS,
    MACHINE_TASK_TYPES,
    bool,
    hasStrictMachineProvenance,
    isAiAssisted,
    isAttendance,
    isIntegration,
    isPrivateOrPersonal,
    isTerminalOrArchived,
    normalize,
    numeric,
    protectionFlags
} = require('./taskAutomationPolicy');

const CLASSIFIER_VERSION = 'task_stale_machine_report_v1_2026_08_10';
const CANCELLED_BOOKING_STATUSES = new Set(BOOKING_TERMINAL_STATUSES);
const MACHINE_CREATOR_SET = new Set(MACHINE_CREATORS);
const MACHINE_TASK_TYPE_SET = new Set(MACHINE_TASK_TYPES);

function sha256(payload) {
    return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function sortedTaskIds(rows) {
    return rows.map(row => Number(row.task_id || row.id)).filter(Number.isFinite).sort((a, b) => a - b);
}

function isStrictRuleEngineBooking(row = {}) {
    return hasStrictMachineProvenance({
        ...row,
        source_type: 'booking',
        creator_class: row.creator_class || row.created_by_normalized,
        type: row.task_type || row.type || row.task_type_legacy
    }) && normalize(row.source_type) === 'booking';
}

function isRecurringTemplateGenerated(row = {}) {
    const sourceType = normalize(row.source_type);
    const taskType = normalize(row.task_type || row.type || row.task_type_legacy);
    const creatorClass = normalize(row.creator_class || row.created_by_normalized);
    return (sourceType === 'recurring' || taskType === 'recurring' || bool(row.has_template_id))
        && MACHINE_CREATOR_SET.has(creatorClass)
        && numeric(row.created_by_user_id) === 0;
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
        sameTemplateDateDuplicate: bool(row.same_template_date_duplicate),
        protectionFlags: protectionFlags(row).sort()
    };
}

function privateRecord(item = {}) {
    const row = item.row || item;
    const classification = item.classification || classifyStaleMachineTask(row);
    return {
        taskId: Number(row.task_id || row.id),
        cohort: classification.cohort,
        decision: classification.decision,
        reason: classification.reason,
        candidateArchiveReason: classification.candidateArchiveReason || null,
        evidence: safeEvidence(row)
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
                decision: 'protected',
                cohort: 'protected_booking_past_active_needs_business_decision',
                reason: 'past_active_booking_parent_is_not_terminal'
            };
        }
    }

    if (isRecurringTemplateGenerated(row)) {
        if (bool(row.template_found) && bool(row.template_active) && bool(row.template_context_match)) {
            if (bool(row.same_template_date_duplicate)) {
                return {
                    decision: 'protected',
                    cohort: 'protected_recurring_same_template_date_duplicate_review',
                    reason: 'recurring_same_template_date_duplicate_requires_operator_review'
                };
            }
            return {
                decision: 'protected',
                cohort: 'protected_recurring_expected_template_series',
                reason: 'template_lineage_is_valid_report_only'
            };
        }

        if (!bool(row.template_found)) {
            return {
                decision: 'protected',
                cohort: 'protected_recurring_missing_or_orphan_template',
                reason: 'recurring_template_missing_or_orphaned'
            };
        }

        if (!bool(row.template_active)) {
            return {
                decision: 'protected',
                cohort: 'protected_recurring_inactive_template_residual',
                reason: 'recurring_current_template_inactive_not_historical_proof'
            };
        }

        return {
            decision: 'protected',
            cohort: 'protected_recurring_template_context_mismatch',
            reason: 'recurring_template_lineage_missing_inactive_or_mismatched'
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
                records: group.rows
                    .map(privateRecord)
                    .sort((a, b) => a.taskId - b.taskId),
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

    const overdueCohorts = cohorts
        .map(cohort => ({
            cohort: cohort.cohort,
            decision: cohort.decision,
            count: cohort.records.filter(record => record.evidence.canonicalOverdue === true).length,
            membershipChecksum: sha256({
                classifierVersion: CLASSIFIER_VERSION,
                kyivToday,
                overdueOnly: true,
                cohort: cohort.cohort,
                ids: cohort.records
                    .filter(record => record.evidence.canonicalOverdue === true)
                    .map(record => record.taskId)
                    .sort((a, b) => a - b)
            }),
            evidenceChecksum: sha256({
                classifierVersion: CLASSIFIER_VERSION,
                kyivToday,
                overdueOnly: true,
                cohort: cohort.cohort,
                rows: cohort.records
                    .filter(record => record.evidence.canonicalOverdue === true)
                    .map(record => record.evidence)
                    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
            })
        }))
        .filter(cohort => cohort.count > 0)
        .sort((a, b) => a.cohort.localeCompare(b.cohort));

    const automationOverdueTotal = rows.filter(row => bool(row.canonical_overdue)).length;
    const overdueReconciledTotal = overdueCohorts.reduce((sum, cohort) => sum + cohort.count, 0);
    const overdueReconciliation = {
        automationOverdueTotal,
        reconciledTotal: overdueReconciledTotal,
        ok: automationOverdueTotal === overdueReconciledTotal,
        cohorts: overdueCohorts,
        checksum: sha256({
            classifierVersion: CLASSIFIER_VERSION,
            kyivToday,
            automationOverdueTotal,
            cohorts: overdueCohorts.map(cohort => ({
                cohort: cohort.cohort,
                decision: cohort.decision,
                count: cohort.count,
                membershipChecksum: cohort.membershipChecksum,
                evidenceChecksum: cohort.evidenceChecksum
            }))
        })
    };

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
            ignored: ignoredTotal,
            automationOverdue: automationOverdueTotal
        },
        cohorts,
        overdueReconciliation,
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
        overdueReconciliation: report.overdueReconciliation ? {
            automationOverdueTotal: report.overdueReconciliation.automationOverdueTotal,
            reconciledTotal: report.overdueReconciliation.reconciledTotal,
            ok: report.overdueReconciliation.ok,
            checksum: report.overdueReconciliation.checksum,
            cohorts: (report.overdueReconciliation.cohorts || []).map(cohort => ({
                cohort: cohort.cohort,
                decision: cohort.decision,
                count: cohort.count,
                membershipChecksum: cohort.membershipChecksum,
                evidenceChecksum: cohort.evidenceChecksum
            }))
        } : null,
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

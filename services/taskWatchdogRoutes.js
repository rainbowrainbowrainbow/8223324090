'use strict';

const {
    DEFAULT_OWNER_SCOPE,
    REASON_CODES,
    buildTaskWatchdogAutoRescheduleBatch,
    buildTaskWatchdogAutoRescheduleMutationPlan,
    handleTaskWatchdogAck,
    normalizeOwnerScope,
    normalizePositiveInt,
    parseTaskWatchdogCallbackData,
    runTaskWatchdogCycle
} = require('./taskWatchdog');

const SOLO_ROLLOUT_OWNER_SCOPE = {
    4: { crmOwnerUserId: 4, displayName: 'Сергій' }
};

const PREVIEW_SAFETY = Object.freeze({
    wouldSendTelegram: false,
    wouldMutateCrm: false,
    wouldEnableCron: false,
    wouldApplyMigration: false,
    wouldDeploy: false
});

const LIVE_APPROVALS_REQUIRED = Object.freeze([
    'DB migration apply for task_watchdog_events',
    'Telegram send enablement for exact CRM owner scope',
    'CRM write approval for auto-reschedule mutation plan',
    'cron/gateway enablement',
    'deploy/restart approval'
]);

function redactWatchdogTargets(value) {
    if (Array.isArray(value)) return value.map(redactWatchdogTargets);
    if (!value || typeof value !== 'object') return value;
    const output = {};
    for (const [key, item] of Object.entries(value)) {
        if (/telegram.*(chat|user).*id/i.test(key) || /chatId|userIdOrChatId/i.test(key)) {
            output[key] = item ? '[redacted-present]' : null;
        } else {
            output[key] = redactWatchdogTargets(item);
        }
    }
    return output;
}

function resolveRequestValue(req, key) {
    if (req?.body && Object.prototype.hasOwnProperty.call(req.body, key)) return req.body[key];
    if (req?.query && Object.prototype.hasOwnProperty.call(req.query, key)) return req.query[key];
    return undefined;
}

function resolveHeaderValue(req, key) {
    if (req?.headers && Object.prototype.hasOwnProperty.call(req.headers, key)) return req.headers[key];
    if (typeof req?.get === 'function') return req.get(key);
    return undefined;
}

function createJsonResponse(res, statusCode, body) {
    return res.status(statusCode).json(redactWatchdogTargets(body));
}

function normalizeTaskForAutoReschedulePreview(task = {}) {
    return {
        ...task,
        id: task.id ?? task.taskId,
        owner_user_id: task.owner_user_id ?? task.ownerUserId,
        account_user_id: task.account_user_id ?? task.accountUserId ?? task.ownerUserId,
        deadline: task.deadline ?? task.dueAt,
        created_at: task.created_at ?? task.createdAt,
        updated_at: task.updated_at ?? task.updatedAt,
        priority: task.priority,
        status: task.status
    };
}

function compactCycleReceipt(cycle = {}) {
    const report = cycle.report || {};
    return {
        ok: cycle.ok === true,
        mode: cycle.mode || 'task_watchdog_cycle',
        dryRun: true,
        liveSideEffects: false,
        ownerScope: Array.isArray(cycle.ownerScope) ? cycle.ownerScope : [],
        receipt: cycle.receipt || null,
        totals: report.totals || null,
        ackRequiredCount: cycle.ackRequiredCount || 0,
        blockers: cycle.blockers || [],
        reasonCodes: cycle.reasonCodes || []
    };
}

function compactDigestPreview(cycle = {}) {
    const digests = Array.isArray(cycle.ownerDigests) ? cycle.ownerDigests : [];
    return {
        mode: 'grouped_owner_digest_preview',
        grouped: true,
        perTaskSpam: false,
        count: digests.length,
        owners: digests.map(digest => ({
            ownerUserId: digest.ownerUserId,
            ownerName: digest.ownerName || null,
            taskCount: digest.taskCount ?? digest.tasks?.length ?? 0,
            candidateCount: digest.candidateCount ?? digest.notificationCandidates?.length ?? 0,
            textPreview: digest.text || digest.message || null
        }))
    };
}

function compactAutoReschedulePreview(batch = {}) {
    return {
        ok: batch.ok === true,
        mode: batch.mode || 'task_watchdog_auto_reschedule_batch',
        dryRun: true,
        liveSideEffects: false,
        ownerUserId: batch.ownerUserId || null,
        summary: batch.summary || null,
        proposedCount: Array.isArray(batch.proposedChanges) ? batch.proposedChanges.length : 0,
        blockedCount: Array.isArray(batch.blockedTasks) ? batch.blockedTasks.length : 0,
        approvalPacket: batch.approvalPacket ? {
            packetId: batch.approvalPacket.packetId,
            fields: batch.approvalPacket.fields,
            maxTasks: batch.approvalPacket.maxTasks,
            approvalString: batch.approvalPacket.approvalString
        } : null,
        safety: batch.safety || { crmWrites: 0, telegramSends: 0, cronGatewayDeploy: false, secretReads: 0 }
    };
}

function compactMutationPlanPreview(plan = {}) {
    return {
        ok: plan.ok === true,
        mode: plan.mode || 'task_watchdog_auto_reschedule_mutation_plan',
        dryRun: true,
        liveSideEffects: false,
        ownerUserId: plan.ownerUserId || null,
        approvalRequired: plan.approvalRequired === true,
        approved: plan.approved === true,
        summary: plan.summary || null,
        operationCount: Array.isArray(plan.operations) ? plan.operations.length : 0,
        readbackCount: Array.isArray(plan.readbackPlan) ? plan.readbackPlan.length : 0,
        rollbackCount: Array.isArray(plan.rollbackPlan) ? plan.rollbackPlan.length : 0,
        approvalPacket: plan.approvalPacket || null,
        safety: plan.safety || { crmWrites: 0, telegramSends: 0, cronGatewayDeploy: false, secretReads: 0 }
    };
}

function createTaskWatchdogDryRunHandler({ pool, ownerScope = DEFAULT_OWNER_SCOPE, runCycle = runTaskWatchdogCycle } = {}) {
    const normalizedScope = normalizeOwnerScope(ownerScope);
    return async function taskWatchdogDryRunHandler(req, res, next) {
        try {
            const ownerUserId = normalizePositiveInt(req?.query?.ownerUserId);
            if (!ownerUserId || !normalizedScope.has(ownerUserId)) {
                return createJsonResponse(res, 400, {
                    ok: false,
                    dryRun: true,
                    liveSideEffects: false,
                    reasonCode: REASON_CODES.OWNER_NOT_ALLOWED
                });
            }
            const result = await runCycle(pool, {
                ownerUserId,
                ownerScope: normalizedScope,
                dryRun: true,
                notificationMode: 'plan'
            });
            return createJsonResponse(res, result.ok ? 200 : 400, {
                ...result,
                dryRun: true,
                liveSideEffects: false
            });
        } catch (error) {
            if (typeof next === 'function') return next(error);
            throw error;
        }
    };
}

function createTaskWatchdogPreviewHandler({
    pool,
    ownerScope = SOLO_ROLLOUT_OWNER_SCOPE,
    runCycle = runTaskWatchdogCycle,
    buildAutoRescheduleBatch = buildTaskWatchdogAutoRescheduleBatch,
    buildMutationPlan = buildTaskWatchdogAutoRescheduleMutationPlan
} = {}) {
    const normalizedScope = normalizeOwnerScope(ownerScope);
    return async function taskWatchdogPreviewHandler(req, res, next) {
        try {
            const ownerUserId = normalizePositiveInt(resolveRequestValue(req, 'ownerUserId')) || 4;
            if (!ownerUserId || !normalizedScope.has(ownerUserId)) {
                return createJsonResponse(res, 400, {
                    ok: false,
                    mode: 'task_watchdog_preview',
                    dryRun: true,
                    liveSideEffects: false,
                    ownerUserId,
                    reasonCode: REASON_CODES.OWNER_NOT_ALLOWED,
                    safety: PREVIEW_SAFETY
                });
            }

            const cycle = await runCycle(pool, {
                dryRun: true,
                notificationMode: 'plan',
                groupByOwner: true,
                ownerUserId,
                ownerScope: normalizedScope
            });
            const reportTasks = Array.isArray(cycle?.report?.tasks) ? cycle.report.tasks : [];
            const rawRows = Array.isArray(cycle?.report?.rawRows) ? cycle.report.rawRows : reportTasks;
            const autoRescheduleTasks = rawRows.map(normalizeTaskForAutoReschedulePreview);
            const autoRescheduleBatch = buildAutoRescheduleBatch(autoRescheduleTasks, {
                ownerUserId,
                ownerScope: normalizedScope,
                dryRun: true,
                allowWrite: false,
                execute: false,
                watchdogRunId: cycle?.generatedAt || 'task-watchdog-preview'
            });
            const mutationPlan = buildMutationPlan(autoRescheduleBatch, { ownerUserId });

            return createJsonResponse(res, cycle?.ok === false ? 400 : 200, {
                ok: cycle?.ok === true,
                mode: 'task_watchdog_preview',
                dryRun: true,
                liveSideEffects: false,
                ownerUserId,
                safety: PREVIEW_SAFETY,
                cycleReceipt: compactCycleReceipt(cycle),
                digestPreview: compactDigestPreview(cycle),
                autoReschedulePreview: compactAutoReschedulePreview(autoRescheduleBatch),
                mutationPlanPreview: compactMutationPlanPreview(mutationPlan),
                approvalRequiredForLive: [...LIVE_APPROVALS_REQUIRED]
            });
        } catch (error) {
            if (typeof next === 'function') return next(error);
            throw error;
        }
    };
}

function createTaskWatchdogCallbackDryRunHandler({ pool, ownerScope = SOLO_ROLLOUT_OWNER_SCOPE, handleAck = handleTaskWatchdogAck } = {}) {
    const normalizedScope = normalizeOwnerScope(ownerScope);
    return async function taskWatchdogCallbackDryRunHandler(req, res, next) {
        try {
            const callbackData = resolveRequestValue(req, 'callbackData') ?? resolveRequestValue(req, 'data');
            const parsed = parseTaskWatchdogCallbackData(callbackData);
            if (!parsed.ok || parsed.action !== 'ack') {
                return createJsonResponse(res, 400, {
                    ok: false,
                    mode: 'task_watchdog_callback_dry_run',
                    dryRun: true,
                    liveSideEffects: false,
                    wouldMutateCrm: false,
                    reasonCode: REASON_CODES.CALLBACK_DATA_UNSAFE
                });
            }

            const actorCrmUserId = normalizePositiveInt(
                resolveRequestValue(req, 'actorCrmUserId') ??
                resolveHeaderValue(req, 'actorCrmUserId') ??
                resolveHeaderValue(req, 'x-actor-crm-user-id')
            );
            if (!actorCrmUserId) {
                return createJsonResponse(res, 400, {
                    ok: false,
                    mode: 'task_watchdog_callback_dry_run',
                    dryRun: true,
                    liveSideEffects: false,
                    wouldMutateCrm: false,
                    reasonCode: 'ACTOR_CRM_USER_REQUIRED'
                });
            }

            const ack = await handleAck(pool, {
                callbackData,
                actorCrmUserId,
                ownerScope: normalizedScope,
                dryRun: true,
                allowWrite: false
            });

            return createJsonResponse(res, ack.ok ? 200 : 400, {
                ...ack,
                mode: 'task_watchdog_callback_dry_run',
                dryRun: true,
                liveSideEffects: false,
                wouldMutateCrm: false
            });
        } catch (error) {
            if (typeof next === 'function') return next(error);
            throw error;
        }
    };
}

function buildTaskWatchdogSoloRolloutPacket({ ownerUserId = 4, workHours = '09:00-23:00', maxMessagesPerDay = 10 } = {}) {
    return {
        mode: 'task_watchdog_solo_rollout_packet',
        ownerUserId,
        dryRun: true,
        liveSideEffects: false,
        currentSafeLocalGates: {
            send: false,
            crmWrite: false,
            cron: false,
            gateway: false,
            liveSideEffects: false,
            dryRun: true,
            ownerScope: [ownerUserId],
            workHours,
            maxMessagesPerDay
        },
        stagesToEnableLater: [
            'apply DB migration after approval',
            'enable Telegram send for approved owner scope',
            'enable CRM auto-reschedule writes after exact approval string',
            'enable cron/gateway after dry-run receipts are reviewed',
            'deploy/restart after release approval'
        ],
        exactApprovalsStillRequired: [...LIVE_APPROVALS_REQUIRED],
        stopCriteria: [
            'any Telegram/CRM identity mismatch',
            'owner scope wider than approved CRM owner ids',
            'unexpected write/network/deploy attempt',
            'verification failure',
            'approval string mismatch'
        ]
    };
}

module.exports = {
    buildTaskWatchdogSoloRolloutPacket,
    createTaskWatchdogCallbackDryRunHandler,
    createTaskWatchdogDryRunHandler,
    createTaskWatchdogPreviewHandler,
    redactWatchdogTargets
};

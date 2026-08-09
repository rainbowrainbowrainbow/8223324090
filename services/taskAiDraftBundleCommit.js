'use strict';

const crypto = require('node:crypto');

const { pool } = require('../db');
const { TASK_ACTION_TYPES, logTaskActionEvent } = require('./taskActionHistory');
const { replaceTaskClassification, normalizeImpactIds } = require('./myDayTaxonomy');
const { MY_DAY_TASK_AI_MODEL, compactString } = require('./myDayTaskOpenAIClient');
const { recordTaskAiDraftTelemetry } = require('./taskAiDraftTelemetry');
const {
    TASK_AI_DRAFT_CONTRACT_VERSION,
    TASK_AI_DRAFT_PROMPT_VERSION,
    activeImpactCatalogVersion,
    proposalHash,
    stableStringify,
    verifyProposalToken
} = require('./taskAiDraftPreview');
const {
    hashCommitRequest,
    legacyTaskTextRef,
    normalizeIdempotencyKey
} = require('./taskAiDraftCommit');

const MIN_BUNDLE_COMMIT_TASKS = 2;
const MAX_BUNDLE_COMMIT_TASKS = 6;
const MAX_BUNDLE_TITLE_CHARS = 180;
const MAX_BUNDLE_DESCRIPTION_CHARS = 700;
const AI_DRAFT_BUNDLE_COMMIT_SOURCE_SURFACE = 'task_ai_draft_bundle_commit';
const AI_DRAFT_BUNDLE_SOURCE_TYPE = 'ai_draft_bundle';
const BUNDLE_PRIORITIES = Object.freeze(['urgent', 'high', 'normal', 'low']);

function bundleCommitError(message, statusCode, code) {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    return error;
}

function safeRecordBundleTelemetry(event = {}, options = {}) {
    try {
        return recordTaskAiDraftTelemetry(event, options);
    } catch {
        return null;
    }
}

function normalizePriority(value) {
    const raw = value === undefined || value === null || value === '' ? 'normal' : value;
    const priority = String(raw || '').trim().toLowerCase();
    if (!BUNDLE_PRIORITIES.includes(priority)) {
        throw bundleCommitError('Bundle task priority is invalid.', 400, 'TASK_AI_BUNDLE_PRIORITY_INVALID');
    }
    return priority;
}

function normalizeDueDate(value) {
    const text = String(value || '').trim();
    if (!text) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        throw bundleCommitError('Bundle task due date is invalid.', 400, 'TASK_AI_BUNDLE_DUE_DATE_INVALID');
    }
    return text;
}

function normalizeOwnerSuggestion(value = {}) {
    const owner = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const userId = Number(owner.userId || owner.user_id || 0);
    return {
        userId: Number.isInteger(userId) && userId > 0 ? userId : null,
        name: compactString(owner.name || owner.label, 120) || null,
        reason: compactString(owner.reason, 160) || null
    };
}

function normalizeBundleTask(value = {}, index = 0) {
    const task = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const title = compactString(task.title, MAX_BUNDLE_TITLE_CHARS);
    if (!title) {
        throw bundleCommitError(`Task ${index + 1} title is required.`, 400, 'TASK_AI_BUNDLE_TASK_TITLE_REQUIRED');
    }
    return {
        title,
        description: compactString(task.description, MAX_BUNDLE_DESCRIPTION_CHARS) || null,
        impactIds: normalizeImpactIds(task.impactIds ?? task.impact_ids ?? []),
        priority: normalizePriority(task.priority),
        dueDate: normalizeDueDate(task.dueDate || task.due_date || task.date),
        ownerSuggestion: normalizeOwnerSuggestion(task.ownerSuggestion || task.owner_suggestion || {}),
        userEdited: task.userEdited === true || task.user_edited === true
    };
}

function normalizeBundleTasks(value) {
    const rows = Array.isArray(value) ? value : [];
    if (rows.length < MIN_BUNDLE_COMMIT_TASKS) {
        throw bundleCommitError('Bundle commit requires at least two accepted tasks.', 400, 'TASK_AI_BUNDLE_TOO_SMALL');
    }
    if (rows.length > MAX_BUNDLE_COMMIT_TASKS) {
        throw bundleCommitError('Bundle commit contains too many tasks.', 400, 'TASK_AI_BUNDLE_TOO_LARGE');
    }
    return rows.map(normalizeBundleTask);
}

function normalizeAcceptedTaskMask(value, taskCount) {
    const raw = Array.isArray(value) ? value : [];
    if (!raw.length) return Array.from({ length: taskCount }, (_, index) => index);
    const mask = [...new Set(raw
        .map(item => Number(item))
        .filter(item => Number.isInteger(item) && item >= 0 && item < taskCount))];
    if (!mask.length) {
        throw bundleCommitError('Accepted task mask is empty.', 400, 'TASK_AI_BUNDLE_MASK_EMPTY');
    }
    return mask;
}

function normalizeRejectedTaskMask(value, taskCount) {
    const raw = Array.isArray(value) ? value : [];
    return [...new Set(raw
        .map(item => Number(item))
        .filter(item => Number.isInteger(item) && item >= 0 && item < taskCount))];
}

function normalizeSubmittedProposalHash(body = {}) {
    const direct = String(body.proposalHash || body.proposal_hash || '').trim();
    if (direct) return direct;
    if (body.proposal && typeof body.proposal === 'object' && !Array.isArray(body.proposal)) {
        return proposalHash(body.proposal);
    }
    throw bundleCommitError('Proposal hash is required.', 400, 'TASK_AI_DRAFT_PROPOSAL_HASH_REQUIRED');
}

function normalizeBundleTitle(value, fallback = 'AI task bundle') {
    return compactString(value, MAX_BUNDLE_TITLE_CHARS) || fallback;
}

function activeImpactIdSet(impacts = []) {
    return new Set((Array.isArray(impacts) ? impacts : [])
        .filter(impact => impact && impact.isActive !== false)
        .map(impact => Number(impact.id))
        .filter(id => Number.isInteger(id) && id > 0));
}

function validateBundleTasksAgainstRuntime({ tasks, activeImpacts, userId }) {
    const allowedImpactIds = activeImpactIdSet(activeImpacts);
    for (const [index, task] of tasks.entries()) {
        const unknownImpactIds = task.impactIds.filter(id => !allowedImpactIds.has(Number(id)));
        if (unknownImpactIds.length) {
            throw bundleCommitError(`Bundle task ${index + 1} contains unavailable impact IDs.`, 422, 'TASK_AI_BUNDLE_UNKNOWN_IMPACT');
        }
        if (task.ownerSuggestion?.userId && Number(task.ownerSuggestion.userId) !== Number(userId)) {
            throw bundleCommitError('Bundle task owner suggestion must be confirmed with an allowed user picker.', 400, 'TASK_AI_BUNDLE_OWNER_INVALID');
        }
    }
}

function bundleIdForToken(tokenPayload = {}, submittedProposalHash = '') {
    return crypto
        .createHash('sha256')
        .update(stableStringify({
            type: 'task_ai_bundle',
            proposalId: tokenPayload.proposalId || null,
            proposalHash: submittedProposalHash || tokenPayload.proposalHash || null,
            draftFingerprint: tokenPayload.draftFingerprint || null
        }))
        .digest('base64url')
        .slice(0, 32);
}

function ensureTokenMatchesBundleRequest({ tokenPayload, userId, businessScope, activeImpacts, body }) {
    if (Number(tokenPayload.userId || 0) !== Number(userId || 0)) {
        throw bundleCommitError('Proposal token belongs to another user.', 403, 'TASK_AI_DRAFT_TOKEN_USER_MISMATCH');
    }
    const businessContext = businessScope?.businessContext || businessScope?.business_context || null;
    if (businessContext && tokenPayload.businessContext && tokenPayload.businessContext !== businessContext) {
        throw bundleCommitError('Proposal token belongs to another business scope.', 403, 'TASK_AI_DRAFT_TOKEN_SCOPE_MISMATCH');
    }
    const submittedDraftFingerprint = String(body.draftFingerprint || body.draft_fingerprint || body.baseDraftFingerprint || body.base_draft_fingerprint || '').trim();
    if (submittedDraftFingerprint && submittedDraftFingerprint !== tokenPayload.draftFingerprint) {
        throw bundleCommitError('Draft fingerprint does not match proposal token.', 409, 'TASK_AI_DRAFT_FINGERPRINT_CONFLICT');
    }
    const submittedProposalHash = normalizeSubmittedProposalHash(body);
    if (submittedProposalHash !== tokenPayload.proposalHash) {
        throw bundleCommitError('Proposal hash does not match proposal token.', 409, 'TASK_AI_DRAFT_PROPOSAL_CONFLICT');
    }
    const catalogVersion = activeImpactCatalogVersion(activeImpacts);
    if (tokenPayload.catalogVersion && tokenPayload.catalogVersion !== catalogVersion) {
        throw bundleCommitError('Impact catalog changed after preview.', 409, 'TASK_AI_DRAFT_CATALOG_CHANGED');
    }
    const proposalDecision = String(body.proposal?.decision || '').trim();
    if (proposalDecision && proposalDecision !== 'task_bundle') {
        throw bundleCommitError('Proposal is not a task bundle.', 409, 'TASK_AI_BUNDLE_PROPOSAL_INVALID');
    }
    return { submittedProposalHash, catalogVersion };
}

async function findBundleReplay(client, { userId, idempotencyKey, businessScope }) {
    const params = [
        TASK_ACTION_TYPES.AI_DRAFT_BUNDLE_COMMITTED,
        Number(userId),
        idempotencyKey
    ];
    let businessSql = '';
    const businessContext = businessScope?.businessContext || businessScope?.business_context || null;
    if (businessContext) {
        params.push(businessContext);
        businessSql = ` AND COALESCE(t.business_context, 'event_genix') = $${params.length}`;
    }
    const result = await client.query(
        `SELECT h.*, t.id AS anchor_task_id, t.business_context
         FROM task_action_history h
         JOIN tasks t ON t.id = h.task_id
         WHERE h.action_type = $1
           AND h.actor_user_id = $2
           AND h.meta_json->>'idempotencyKey' = $3
           ${businessSql}
         ORDER BY h.created_at DESC, h.id DESC
         LIMIT 1`,
        params
    );
    return result.rows?.[0] || null;
}

async function fetchReplayTasks(client, taskIds = []) {
    const ids = [...new Set((Array.isArray(taskIds) ? taskIds : [])
        .map(id => Number(id))
        .filter(id => Number.isInteger(id) && id > 0))];
    if (!ids.length) return [];
    const result = await client.query(
        `SELECT *
         FROM tasks
         WHERE id = ANY($1::int[])
         ORDER BY array_position($1::int[], id)`,
        [ids]
    );
    return result.rows || [];
}

async function replayBundleResponse(client, row = {}) {
    const meta = row.meta_json || {};
    const newValue = row.new_value_json || {};
    const taskIds = Array.isArray(meta.taskIds) ? meta.taskIds : (Array.isArray(newValue.taskIds) ? newValue.taskIds : []);
    const tasks = await fetchReplayTasks(client, taskIds);
    return {
        ok: true,
        replayed: true,
        bundle: {
            id: meta.bundleId || newValue.bundleId || null,
            title: meta.bundleTitle || null,
            taskIds,
            taskCount: taskIds.length
        },
        tasks,
        historyEvent: {
            id: row.id,
            taskId: row.task_id,
            actionType: row.action_type,
            meta,
            createdAt: row.created_at || null
        }
    };
}

function taskControlMetaForBundle({ bundleId, index, taskCount }) {
    return {
        aiDraftBundle: {
            bundleId,
            taskIndex: index,
            taskCount,
            contractVersion: TASK_AI_DRAFT_CONTRACT_VERSION,
            promptVersion: TASK_AI_DRAFT_PROMPT_VERSION
        }
    };
}

async function commitTaskAiDraftBundle(input = {}, options = {}) {
    const startedAt = Date.now();
    const db = options.pool || pool;
    const tasks = normalizeBundleTasks(input.tasks || input.finalTasks || input.final_tasks || []);
    const acceptedTaskMask = normalizeAcceptedTaskMask(input.acceptedTaskMask || input.accepted_task_mask || input.acceptedTasks || input.accepted_tasks, tasks.length);
    const rejectedTaskMask = normalizeRejectedTaskMask(input.rejectedTaskMask || input.rejected_task_mask || input.rejectedTasks || input.rejected_tasks, tasks.length);
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey || input.idempotency_key);
    const userId = Number(input.userId || input.user?.id || 0);
    if (!Number.isInteger(userId) || userId <= 0) throw bundleCommitError('Valid user is required.', 401, 'TASK_AI_DRAFT_USER_REQUIRED');
    validateBundleTasksAgainstRuntime({
        tasks,
        activeImpacts: input.activeImpacts || input.impacts || [],
        userId
    });

    const tokenPayload = verifyProposalToken(input.proposalToken || input.proposal_token, {
        secret: options.proposalSecret || options.safetySecret,
        userId,
        businessScope: input.businessScope,
        now: options.now
    });
    const { submittedProposalHash, catalogVersion } = ensureTokenMatchesBundleRequest({
        tokenPayload,
        userId,
        businessScope: input.businessScope,
        activeImpacts: input.activeImpacts || input.impacts || [],
        body: input
    });

    const bundleTitle = normalizeBundleTitle(input.bundleTitle || input.bundle_title || input.proposal?.bundleTitle);
    const bundleId = bundleIdForToken(tokenPayload, submittedProposalHash);
    const requestHash = hashCommitRequest({
        bundleId,
        bundleTitle,
        tasks,
        acceptedTaskMask,
        rejectedTaskMask,
        idempotencyKey,
        proposalHash: submittedProposalHash,
        draftFingerprint: tokenPayload.draftFingerprint,
        catalogVersion
    });

    const client = await db.connect();
    const afterCommit = [];
    try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [
            `task_ai_draft_bundle_commit:${tokenPayload.proposalId || tokenPayload.proposalHash}`
        ]);

        const existing = await findBundleReplay(client, { userId, idempotencyKey, businessScope: input.businessScope });
        if (existing) {
            const meta = existing.meta_json || {};
            if (meta.requestHash && meta.requestHash !== requestHash) {
                throw bundleCommitError('Idempotency key was already used with a different bundle request.', 409, 'TASK_AI_DRAFT_IDEMPOTENCY_CONFLICT');
            }
            const replayed = await replayBundleResponse(client, existing);
            await client.query('COMMIT');
            safeRecordBundleTelemetry({
                type: 'bundle_commit',
                status: 'replayed',
                latencyMs: Date.now() - startedAt,
                model: MY_DAY_TASK_AI_MODEL,
                contractVersion: TASK_AI_DRAFT_CONTRACT_VERSION,
                promptVersion: TASK_AI_DRAFT_PROMPT_VERSION,
                reasonCode: 'idempotent_replay',
                userHash: tokenPayload.proposalId || tokenPayload.proposalHash,
                businessContext: input.businessScope?.businessContext || input.businessScope?.business_context || ''
            }, options.telemetry);
            return replayed;
        }

        const createTaskImpl = options.createTaskImpl || require('./kleshnya').createTask;
        const actorLabel = legacyTaskTextRef(input.user?.username || input.user?.name, 'ai-draft');
        const ownerLabel = legacyTaskTextRef(input.user?.username || input.user?.name, null);
        const sourceId = legacyTaskTextRef(bundleId, null);
        const businessContext = input.businessScope?.businessContext || input.businessScope?.business_context || undefined;
        const createdTasks = [];
        const classifications = [];

        for (let index = 0; index < tasks.length; index += 1) {
            const finalTask = tasks[index];
            const task = await createTaskImpl({
                businessContext,
                title: finalTask.title,
                description: finalTask.description,
                date: finalTask.dueDate,
                priority: finalTask.priority,
                assigned_to: ownerLabel,
                owner_user_id: userId,
                owner: ownerLabel,
                task_type: 'human',
                dependency_ids: [],
                source_type: AI_DRAFT_BUNDLE_SOURCE_TYPE,
                source_id: sourceId,
                category: 'admin',
                subcategory: null,
                created_by: actorLabel,
                created_by_user_id: userId,
                task_mode: 'work',
                task_kind: 'action',
                visibility: 'team',
                workflow_state: 'inbox',
                source_module: 'tasks_ai_draft_bundle_commit',
                control_meta: taskControlMetaForBundle({
                    bundleId,
                    index,
                    taskCount: tasks.length
                }),
                duplicateMode: 'reject'
            }, {
                pool: client,
                skipNotifications: true,
                skipHermesOutbox: true,
                afterCommit
            });

            const classification = await replaceTaskClassification(client, {
                userId,
                taskId: task.id,
                impactIds: finalTask.impactIds
            });
            classifications.push(classification);
            createdTasks.push({
                ...task,
                classification,
                subtask_count: 0,
                subtask_done_count: 0,
                subtasks: []
            });

            await logTaskActionEvent({
                taskId: task.id,
                actionType: TASK_ACTION_TYPES.AI_DRAFT_COMMITTED,
                actor: input.user,
                sourceSurface: input.sourceSurface || AI_DRAFT_BUNDLE_COMMIT_SOURCE_SURFACE,
                oldValue: null,
                newValue: {
                    taskId: Number(task.id),
                    bundleId,
                    bundleTaskIndex: index,
                    impactCount: finalTask.impactIds.length,
                    scheduleWritten: Boolean(finalTask.dueDate)
                },
                meta: {
                    idempotencyKey,
                    requestHash,
                    bundleId,
                    bundleTaskIndex: index,
                    proposalId: tokenPayload.proposalId || null,
                    proposalHash: submittedProposalHash,
                    draftFingerprint: tokenPayload.draftFingerprint,
                    catalogVersion,
                    contractVersion: TASK_AI_DRAFT_CONTRACT_VERSION,
                    promptVersion: TASK_AI_DRAFT_PROMPT_VERSION,
                    provider: 'openai',
                    model: MY_DAY_TASK_AI_MODEL,
                    source: AI_DRAFT_BUNDLE_COMMIT_SOURCE_SURFACE,
                    rawPromptStored: false,
                    rawProviderResponseStored: false
                },
                summary: 'AI-assisted bundle task committed'
            }, { pool: client });
        }

        const taskIds = createdTasks.map(task => Number(task.id));
        const historyEvent = await logTaskActionEvent({
            taskId: taskIds[0],
            actionType: TASK_ACTION_TYPES.AI_DRAFT_BUNDLE_COMMITTED,
            actor: input.user,
            sourceSurface: input.sourceSurface || AI_DRAFT_BUNDLE_COMMIT_SOURCE_SURFACE,
            oldValue: null,
            newValue: {
                bundleId,
                taskIds,
                taskCount: taskIds.length,
                acceptedTaskMask,
                rejectedTaskMask,
                impactCounts: tasks.map(task => task.impactIds.length)
            },
            meta: {
                idempotencyKey,
                requestHash,
                bundleId,
                taskIds,
                proposalId: tokenPayload.proposalId || null,
                proposalHash: submittedProposalHash,
                draftFingerprint: tokenPayload.draftFingerprint,
                catalogVersion,
                contractVersion: TASK_AI_DRAFT_CONTRACT_VERSION,
                promptVersion: TASK_AI_DRAFT_PROMPT_VERSION,
                provider: 'openai',
                model: MY_DAY_TASK_AI_MODEL,
                source: AI_DRAFT_BUNDLE_COMMIT_SOURCE_SURFACE,
                rawPromptStored: false,
                rawProviderResponseStored: false
            },
            summary: 'AI-assisted task bundle committed'
        }, { pool: client });

        await client.query('COMMIT');
        safeRecordBundleTelemetry({
            type: 'bundle_commit',
            status: 'success',
            latencyMs: Date.now() - startedAt,
            model: MY_DAY_TASK_AI_MODEL,
            contractVersion: TASK_AI_DRAFT_CONTRACT_VERSION,
            promptVersion: TASK_AI_DRAFT_PROMPT_VERSION,
            reasonCode: 'bundle_committed',
            userHash: tokenPayload.proposalId || tokenPayload.proposalHash,
            businessContext: input.businessScope?.businessContext || input.businessScope?.business_context || '',
            taskCount: taskIds.length
        }, options.telemetry);

        return {
            ok: true,
            replayed: false,
            bundle: {
                id: bundleId,
                title: bundleTitle,
                taskIds,
                taskCount: taskIds.length
            },
            tasks: createdTasks,
            classifications,
            historyEvent,
            afterCommit
        };
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch {}
        safeRecordBundleTelemetry({
            type: 'bundle_commit',
            status: error?.statusCode === 409 ? 'conflict' : 'rollback',
            latencyMs: Date.now() - startedAt,
            model: MY_DAY_TASK_AI_MODEL,
            contractVersion: TASK_AI_DRAFT_CONTRACT_VERSION,
            promptVersion: TASK_AI_DRAFT_PROMPT_VERSION,
            reasonCode: error?.code || 'TASK_AI_BUNDLE_COMMIT_FAILED',
            businessContext: input.businessScope?.businessContext || input.businessScope?.business_context || '',
            taskCount: tasks.length
        }, options.telemetry);
        throw error;
    } finally {
        client.release();
    }
}

module.exports = {
    AI_DRAFT_BUNDLE_COMMIT_SOURCE_SURFACE,
    AI_DRAFT_BUNDLE_SOURCE_TYPE,
    MAX_BUNDLE_COMMIT_TASKS,
    MIN_BUNDLE_COMMIT_TASKS,
    commitTaskAiDraftBundle,
    normalizeBundleTask,
    normalizeBundleTasks
};

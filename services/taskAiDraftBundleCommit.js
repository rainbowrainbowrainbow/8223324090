'use strict';

const crypto = require('node:crypto');

const { pool } = require('../db');
const { TASK_ACTION_TYPES, logTaskActionEvent } = require('./taskActionHistory');
const { replaceTaskClassification, normalizeImpactIds } = require('./myDayTaxonomy');
const { MY_DAY_TASK_AI_MODEL, compactString } = require('./myDayTaskOpenAIClient');
const { getAssignableTaskOwner } = require('./taskExecution');
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
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00.000Z`) : null;
    if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
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

function validateBundleTasksAgainstRuntime({ tasks, activeImpacts }) {
    const allowedImpactIds = activeImpactIdSet(activeImpacts);
    for (const [index, task] of tasks.entries()) {
        const unknownImpactIds = task.impactIds.filter(id => !allowedImpactIds.has(Number(id)));
        if (unknownImpactIds.length) {
            throw bundleCommitError(`Bundle task ${index + 1} contains unavailable impact IDs.`, 422, 'TASK_AI_BUNDLE_UNKNOWN_IMPACT');
        }
    }
}

function validateTaskMasks({ acceptedTaskMask, rejectedTaskMask, taskCount, proposalTaskCount }) {
    if (acceptedTaskMask.length !== taskCount) {
        throw bundleCommitError('Accepted task mask does not match the committed task list.', 400, 'TASK_AI_BUNDLE_MASK_INVALID');
    }
    const accepted = new Set(acceptedTaskMask);
    if (rejectedTaskMask.some(index => accepted.has(index))) {
        throw bundleCommitError('Accepted and rejected task masks overlap.', 400, 'TASK_AI_BUNDLE_MASK_INVALID');
    }
    if (proposalTaskCount && acceptedTaskMask.length + rejectedTaskMask.length !== proposalTaskCount) {
        throw bundleCommitError('Task masks must account for every proposed bundle task.', 400, 'TASK_AI_BUNDLE_MASK_INVALID');
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
    const businessContext = businessScope?.businessContext || businessScope?.business_context || 'event_genix';
    const result = await client.query(
        `SELECT b.*
         FROM task_bundles b
         WHERE b.created_by_user_id = $1
           AND b.business_context = $2
           AND b.idempotency_key = $3
         ORDER BY b.created_at DESC
         LIMIT 1`,
        [Number(userId), businessContext, idempotencyKey]
    );
    return result.rows?.[0] || null;
}

async function fetchBundleTasks(client, bundleId) {
    const result = await client.query(
        `SELECT t.*, bt.task_index AS bundle_task_index, bt.user_edited AS bundle_user_edited
         FROM task_bundle_tasks bt
         JOIN tasks t ON t.id = bt.task_id
         WHERE bt.bundle_id = $1
         ORDER BY bt.task_index ASC`,
        [bundleId]
    );
    return result.rows || [];
}

async function replayBundleResponse(client, row = {}) {
    const tasks = await fetchBundleTasks(client, row.id);
    const taskIds = tasks.map(task => Number(task.id));
    return {
        ok: true,
        replayed: true,
        bundle: {
            id: row.id,
            title: row.title,
            status: row.status,
            taskIds,
            taskCount: Number(row.task_count || taskIds.length),
            createdAt: row.created_at || null
        },
        tasks,
        historyEvent: null
    };
}

async function insertTaskBundle(client, bundle = {}) {
    const result = await client.query(
        `INSERT INTO task_bundles (
            id, business_context, title, status, created_by_user_id,
            proposal_id, proposal_hash, draft_fingerprint, catalog_version,
            idempotency_key, request_hash, task_count,
            accepted_task_mask, rejected_task_mask,
            provider, model, contract_version, prompt_version
         ) VALUES (
            $1, $2, $3, 'committed', $4,
            $5, $6, $7, $8,
            $9, $10, $11,
            $12::integer[], $13::integer[],
            'openai', $14, $15, $16
         )
         RETURNING *`,
        [
            bundle.id,
            bundle.businessContext,
            bundle.title,
            bundle.userId,
            bundle.proposalId,
            bundle.proposalHash,
            bundle.draftFingerprint,
            bundle.catalogVersion,
            bundle.idempotencyKey,
            bundle.requestHash,
            bundle.taskCount,
            bundle.acceptedTaskMask,
            bundle.rejectedTaskMask,
            MY_DAY_TASK_AI_MODEL,
            TASK_AI_DRAFT_CONTRACT_VERSION,
            TASK_AI_DRAFT_PROMPT_VERSION
        ]
    );
    return result.rows?.[0] || null;
}

async function insertTaskBundleMembership(client, { bundleId, taskId, taskIndex, userEdited }) {
    await client.query(
        `INSERT INTO task_bundle_tasks (bundle_id, task_id, task_index, user_edited)
         VALUES ($1, $2, $3, $4)`,
        [bundleId, Number(taskId), Number(taskIndex), userEdited === true]
    );
}

async function readTaskBundleForUser(input = {}, options = {}) {
    const db = options.pool || pool;
    const bundleId = String(input.bundleId || input.bundle_id || '').trim();
    const userId = Number(input.userId || input.user?.id || 0);
    const businessContext = input.businessScope?.businessContext || input.businessScope?.business_context || 'event_genix';
    if (!bundleId || !Number.isInteger(userId) || userId <= 0) return null;
    const result = await db.query(
        `SELECT b.*
         FROM task_bundles b
         WHERE b.id = $1
           AND b.created_by_user_id = $2
           AND b.business_context = $3
         LIMIT 1`,
        [bundleId, userId, businessContext]
    );
    const bundle = result.rows?.[0];
    if (!bundle) return null;
    const tasks = await fetchBundleTasks(db, bundle.id);
    const taskIds = tasks.map(task => Number(task.id));
    return {
        id: bundle.id,
        title: bundle.title,
        status: bundle.status,
        taskIds,
        taskCount: Number(bundle.task_count || taskIds.length),
        createdAt: bundle.created_at || null,
        tasks
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
    const proposalTaskCount = Array.isArray(input.proposal?.tasks) ? input.proposal.tasks.length : tasks.length;
    const acceptedTaskMask = normalizeAcceptedTaskMask(input.acceptedTaskMask || input.accepted_task_mask || input.acceptedTasks || input.accepted_tasks, proposalTaskCount);
    const rejectedTaskMask = normalizeRejectedTaskMask(input.rejectedTaskMask || input.rejected_task_mask || input.rejectedTasks || input.rejected_tasks, proposalTaskCount);
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey || input.idempotency_key);
    const userId = Number(input.userId || input.user?.id || 0);
    if (!Number.isInteger(userId) || userId <= 0) throw bundleCommitError('Valid user is required.', 401, 'TASK_AI_DRAFT_USER_REQUIRED');
    validateBundleTasksAgainstRuntime({
        tasks,
        activeImpacts: input.activeImpacts || input.impacts || [],
    });
    validateTaskMasks({ acceptedTaskMask, rejectedTaskMask, taskCount: tasks.length, proposalTaskCount });

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
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [
            `task_ai_draft_bundle_idempotency:${userId}:${input.businessScope?.businessContext || input.businessScope?.business_context || 'event_genix'}:${idempotencyKey}`
        ]);

        const existing = await findBundleReplay(client, { userId, idempotencyKey, businessScope: input.businessScope });
        if (existing) {
            if (existing.request_hash && existing.request_hash !== requestHash) {
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

        const businessContext = input.businessScope?.businessContext || input.businessScope?.business_context || 'event_genix';
        const canonicalBundle = await insertTaskBundle(client, {
            id: bundleId,
            businessContext,
            title: bundleTitle,
            userId,
            proposalId: tokenPayload.proposalId || null,
            proposalHash: submittedProposalHash,
            draftFingerprint: tokenPayload.draftFingerprint,
            catalogVersion,
            idempotencyKey,
            requestHash,
            taskCount: tasks.length,
            acceptedTaskMask,
            rejectedTaskMask
        });

        const createTaskImpl = options.createTaskImpl || require('./kleshnya').createTask;
        const actorLabel = legacyTaskTextRef(input.user?.username || input.user?.name, 'ai-draft');
        const ownerLabel = legacyTaskTextRef(input.user?.username || input.user?.name, null);
        const sourceId = legacyTaskTextRef(bundleId, null);
        const createdTasks = [];
        const classifications = [];
        const resolveOwner = options.getAssignableTaskOwnerImpl || getAssignableTaskOwner;

        for (let index = 0; index < tasks.length; index += 1) {
            const finalTask = tasks[index];
            const requestedOwnerId = Number(finalTask.ownerSuggestion?.userId || userId);
            const ownerRecord = requestedOwnerId === userId
                ? {
                    id: userId,
                    label: ownerLabel || actorLabel
                }
                : await resolveOwner(requestedOwnerId, { pool: client, actor: input.user });
            const task = await createTaskImpl({
                businessContext,
                title: finalTask.title,
                description: finalTask.description,
                date: finalTask.dueDate,
                priority: finalTask.priority,
                assigned_to: ownerRecord.label,
                owner_user_id: ownerRecord.id,
                owner: ownerRecord.label,
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
            await insertTaskBundleMembership(client, {
                bundleId,
                taskId: task.id,
                taskIndex: index,
                userEdited: finalTask.userEdited
            });
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
                id: canonicalBundle?.id || bundleId,
                title: canonicalBundle?.title || bundleTitle,
                status: canonicalBundle?.status || 'committed',
                taskIds,
                taskCount: taskIds.length,
                createdAt: canonicalBundle?.created_at || null
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
    readTaskBundleForUser,
    normalizeBundleTask,
    normalizeBundleTasks
};

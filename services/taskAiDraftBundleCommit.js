'use strict';

const crypto = require('node:crypto');

const { pool } = require('../db');
const { TASK_ACTION_TYPES, logTaskActionEvent } = require('./taskActionHistory');
const { replaceTaskClassification } = require('./myDayTaxonomy');
const { replaceTaskSubtasks } = require('./taskSubtasks');
const { MY_DAY_TASK_AI_MODEL, compactString } = require('./myDayTaskOpenAIClient');
const { getAssignableTaskOwner } = require('./taskExecution');
const {
    recordTaskAiDraftTelemetry,
    releaseTelemetryMetadata,
    safeTelemetryCorrelationId
} = require('./taskAiDraftTelemetry');
const { normalizeDraftItems } = require('./taskDecomposition');
const {
    TASK_AI_DRAFT_CONTRACT_VERSION,
    TASK_AI_DRAFT_BUNDLE_COMMIT_AUDIENCE,
    TASK_AI_DRAFT_PROMPT_VERSION,
    TASK_AI_DRAFT_REASONING_EFFORT,
    activeImpactCatalogVersion,
    proposalHash,
    stableStringify,
    verifyProposalToken
} = require('./taskAiDraftPreview');
const {
    normalizeTaskDraftDescription,
    normalizeTaskDraftImpactIds,
    normalizeTaskDraftImpactSelection,
    normalizeTaskDraftTitle
} = require('./taskAiDraftNormalization');
const {
    hashCommitRequest,
    legacyTaskTextRef,
    normalizeIdempotencyKey
} = require('./taskAiDraftCommit');

const MIN_BUNDLE_COMMIT_TASKS = 2;
const MAX_BUNDLE_COMMIT_TASKS = 6;
const MAX_BUNDLE_TITLE_CHARS = 180;
const MAX_BUNDLE_DESCRIPTION_CHARS = 700;
const MAX_BUNDLE_SUBTASKS = 7;
const AI_DRAFT_BUNDLE_COMMIT_SOURCE_SURFACE = 'task_ai_draft_bundle_commit';
const AI_DRAFT_BUNDLE_SOURCE_TYPE = 'ai_draft_bundle';
const BUNDLE_PRIORITIES = Object.freeze(['urgent', 'high', 'normal', 'low']);
const BUNDLE_FIELD_ALLOWLIST = Object.freeze(['title', 'description', 'impactIds', 'subtasks', 'owner', 'dueDate', 'priority']);
const BUNDLE_FIELD_ALIASES = Object.freeze({
    impact_ids: 'impactIds',
    impacts: 'impactIds',
    scheduleDate: 'dueDate',
    schedule_date: 'dueDate',
    due_date: 'dueDate',
    date: 'dueDate',
    ownerUserId: 'owner',
    owner_user_id: 'owner',
    ownerSuggestion: 'owner',
    owner_suggestion: 'owner'
});
const BUNDLE_TASK_ALLOWED_KEYS = Object.freeze([
    'title',
    'description',
    'impactIds',
    'impact_ids',
    'subtasks',
    'priority',
    'scheduleDate',
    'schedule_date',
    'dueDate',
    'due_date',
    'date',
    'ownerSuggestion',
    'owner_suggestion',
    'userEdited',
    'user_edited',
    'proposalIndex',
    'proposal_index',
    'clientId',
    'client_id',
    'acceptedFieldMask',
    'accepted_field_mask',
    'acceptedFields',
    'accepted_fields',
    'editedFieldMask',
    'edited_field_mask',
    'editedFields',
    'edited_fields'
]);

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

function bundleCorrelationId({ userId, businessContext, idempotencyKey, bundleId, proposalHash: proposalHashValue }) {
    return safeTelemetryCorrelationId('task_ai_draft_bundle_commit', userId, businessContext, idempotencyKey, bundleId, proposalHashValue);
}

function normalizePriority(value) {
    const raw = value === undefined || value === null || value === '' ? 'normal' : value;
    const priority = String(raw || '').trim().toLowerCase();
    if (!BUNDLE_PRIORITIES.includes(priority)) {
        throw bundleCommitError('Bundle task priority is invalid.', 400, 'TASK_AI_BUNDLE_PRIORITY_INVALID');
    }
    return priority;
}

function normalizeScheduleDate(value) {
    const text = String(value || '').trim();
    if (!text) return null;
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00.000Z`) : null;
    if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
        throw bundleCommitError('Bundle task schedule date is invalid.', 400, 'TASK_AI_BUNDLE_SCHEDULE_DATE_INVALID');
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

function normalizeBundleFieldName(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return BUNDLE_FIELD_ALIASES[raw] || raw;
}

function normalizeBundleFieldMask(value, { required = false } = {}) {
    const fields = [...new Set((Array.isArray(value) ? value : [])
        .map(normalizeBundleFieldName)
        .filter(Boolean))];
    const unsupported = fields.filter(field => !BUNDLE_FIELD_ALLOWLIST.includes(field));
    if (unsupported.length) {
        throw bundleCommitError('Bundle field mask contains unsupported fields.', 400, 'TASK_AI_BUNDLE_FIELD_MASK_INVALID');
    }
    if (required && !fields.length) {
        throw bundleCommitError('Bundle task accepted field mask is required.', 400, 'TASK_AI_BUNDLE_FIELD_MASK_REQUIRED');
    }
    return fields;
}

function normalizeBundleFieldMaskMap(value, taskCount) {
    if (!value) return new Map();
    const map = new Map();
    if (Array.isArray(value)) {
        value.forEach((entry, fallbackIndex) => {
            if (Array.isArray(entry)) {
                map.set(fallbackIndex, normalizeBundleFieldMask(entry));
                return;
            }
            if (entry && typeof entry === 'object') {
                const index = Number(entry.proposalIndex ?? entry.proposal_index ?? entry.taskIndex ?? entry.task_index ?? fallbackIndex);
                if (Number.isInteger(index) && index >= 0 && index < taskCount) {
                    map.set(index, normalizeBundleFieldMask(entry.fields || entry.fieldMask || entry.field_mask || entry.acceptedFieldMask || entry.accepted_field_mask));
                }
            }
        });
        return map;
    }
    if (typeof value === 'object') {
        Object.entries(value).forEach(([key, fields]) => {
            const index = Number(key);
            if (Number.isInteger(index) && index >= 0 && index < taskCount) {
                map.set(index, normalizeBundleFieldMask(fields));
            }
        });
    }
    return map;
}

function assertNoUnsupportedTaskFields(task = {}) {
    const unsupported = Object.keys(task).filter(key => !BUNDLE_TASK_ALLOWED_KEYS.includes(key));
    if (unsupported.length) {
        throw bundleCommitError('Bundle task contains unsupported fields.', 400, 'TASK_AI_BUNDLE_TASK_FIELD_UNSUPPORTED');
    }
}

function fieldSubmitted(task = {}, field) {
    if (field === 'impactIds') return Object.prototype.hasOwnProperty.call(task, 'impactIds') || Object.prototype.hasOwnProperty.call(task, 'impact_ids');
    if (field === 'dueDate') {
        return Object.prototype.hasOwnProperty.call(task, 'scheduleDate')
            || Object.prototype.hasOwnProperty.call(task, 'schedule_date')
            || Object.prototype.hasOwnProperty.call(task, 'dueDate')
            || Object.prototype.hasOwnProperty.call(task, 'due_date')
            || Object.prototype.hasOwnProperty.call(task, 'date');
    }
    if (field === 'owner') return Object.prototype.hasOwnProperty.call(task, 'ownerSuggestion') || Object.prototype.hasOwnProperty.call(task, 'owner_suggestion');
    if (field === 'userEdited') return Object.prototype.hasOwnProperty.call(task, 'userEdited') || Object.prototype.hasOwnProperty.call(task, 'user_edited');
    return Object.prototype.hasOwnProperty.call(task, field);
}

function normalizeBundleSubtasks(value) {
    return normalizeDraftItems(Array.isArray(value) ? value : [], {
        sourceType: 'ai',
        maxItems: MAX_BUNDLE_SUBTASKS
    });
}

function normalizeComparableBundleField(task = {}, field) {
    if (field === 'title') return compactString(task.title, MAX_BUNDLE_TITLE_CHARS);
    if (field === 'description') return compactString(task.description, MAX_BUNDLE_DESCRIPTION_CHARS) || null;
    if (field === 'impactIds') return normalizeTaskDraftImpactIds(task.impactIds ?? task.impact_ids ?? []);
    if (field === 'subtasks') return normalizeBundleSubtasks(task.subtasks).map(item => ({ title: item.title }));
    if (field === 'priority') return normalizePriority(task.priority);
    if (field === 'dueDate') return normalizeScheduleDate(task.scheduleDate || task.schedule_date || task.dueDate || task.due_date || task.date);
    if (field === 'owner') return normalizeOwnerSuggestion(task.ownerSuggestion || task.owner_suggestion || {});
    return null;
}

function valuesMatchProposal(finalTask = {}, proposalTask = {}, field) {
    return stableStringify(normalizeComparableBundleField(finalTask, field)) === stableStringify(normalizeComparableBundleField(proposalTask, field));
}

function isEmptyUnacceptedField(task = {}, field) {
    const value = normalizeComparableBundleField(task, field);
    if (field === 'impactIds' || field === 'subtasks') return Array.isArray(value) && value.length === 0;
    if (field === 'priority') return value === 'normal';
    if (field === 'owner') return !value?.userId;
    return value === null || value === '';
}

function normalizeBundleTask(value = {}, index = 0, options = {}) {
    const task = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    assertNoUnsupportedTaskFields(task);
    const acceptedFieldMask = normalizeBundleFieldMask(
        options.acceptedFieldMask || task.acceptedFieldMask || task.accepted_field_mask || task.acceptedFields || task.accepted_fields,
        { required: options.requireFieldMask === true }
    );
    const editedFieldMask = normalizeBundleFieldMask(
        options.editedFieldMask || task.editedFieldMask || task.edited_field_mask || task.editedFields || task.edited_fields
    );
    const accepted = new Set(acceptedFieldMask);
    const edited = new Set(editedFieldMask);
    if (editedFieldMask.some(field => !accepted.has(field))) {
        throw bundleCommitError('Edited bundle fields must also be accepted.', 400, 'TASK_AI_BUNDLE_FIELD_MASK_INVALID');
    }
    for (const field of BUNDLE_FIELD_ALLOWLIST) {
        if (!accepted.has(field) && fieldSubmitted(task, field) && !isEmptyUnacceptedField(task, field)) {
            throw bundleCommitError('Bundle task submitted an unaccepted field.', 400, 'TASK_AI_BUNDLE_FIELD_NOT_ACCEPTED');
        }
    }
    if (options.proposalTask) {
        for (const field of acceptedFieldMask) {
            if (!edited.has(field) && !valuesMatchProposal(task, options.proposalTask, field)) {
                throw bundleCommitError('Bundle task final value differs from the signed proposal without edited provenance.', 409, 'TASK_AI_BUNDLE_REVIEW_CONFLICT');
            }
        }
    }
    if (!accepted.has('title')) {
        throw bundleCommitError(`Task ${index + 1} title field must be accepted.`, 400, 'TASK_AI_BUNDLE_TITLE_NOT_ACCEPTED');
    }
    const title = normalizeTaskDraftTitle(task.title, task);
    if (!title) {
        throw bundleCommitError(`Task ${index + 1} title is required.`, 400, 'TASK_AI_BUNDLE_TASK_TITLE_REQUIRED');
    }
    return {
        title,
        description: accepted.has('description') ? normalizeTaskDraftDescription(task.description, task, title) : null,
        impactIds: accepted.has('impactIds') ? normalizeTaskDraftImpactIds(task.impactIds ?? task.impact_ids ?? []) : [],
        subtasks: accepted.has('subtasks') ? normalizeBundleSubtasks(task.subtasks) : [],
        priority: accepted.has('priority') ? normalizePriority(task.priority) : 'normal',
        scheduleDate: accepted.has('dueDate') ? normalizeScheduleDate(task.scheduleDate || task.schedule_date || task.dueDate || task.due_date || task.date) : null,
        ownerSuggestion: accepted.has('owner') ? normalizeOwnerSuggestion(task.ownerSuggestion || task.owner_suggestion || {}) : normalizeOwnerSuggestion({}),
        acceptedFieldMask,
        editedFieldMask,
        userEdited: task.userEdited === true || task.user_edited === true
    };
}

function normalizeBundleTasks(value, options = {}) {
    const rows = Array.isArray(value) ? value : [];
    if (rows.length < MIN_BUNDLE_COMMIT_TASKS) {
        throw bundleCommitError('Bundle commit requires at least two accepted tasks.', 400, 'TASK_AI_BUNDLE_TOO_SMALL');
    }
    if (rows.length > MAX_BUNDLE_COMMIT_TASKS) {
        throw bundleCommitError('Bundle commit contains too many tasks.', 400, 'TASK_AI_BUNDLE_TOO_LARGE');
    }
    return rows.map((row, index) => normalizeBundleTask(row, index, {
        ...options,
        acceptedFieldMask: options.acceptedFieldMasks?.get(Number(row?.proposalIndex ?? row?.proposal_index ?? index)) || options.acceptedFieldMasks?.get(index),
        editedFieldMask: options.editedFieldMasks?.get(Number(row?.proposalIndex ?? row?.proposal_index ?? index)) || options.editedFieldMasks?.get(index),
        proposalTask: options.proposalTasks?.[Number(row?.proposalIndex ?? row?.proposal_index ?? index)] || options.proposalTasks?.[index]
    }));
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
    if (!submittedDraftFingerprint) {
        throw bundleCommitError('Draft fingerprint is required.', 400, 'TASK_AI_DRAFT_FINGERPRINT_REQUIRED');
    }
    if (submittedDraftFingerprint !== tokenPayload.draftFingerprint) {
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
    const rawTasks = input.tasks || input.finalTasks || input.final_tasks || [];
    const proposalTasks = Array.isArray(input.proposal?.tasks) ? input.proposal.tasks : [];
    const proposalTaskCount = proposalTasks.length || (Array.isArray(rawTasks) ? rawTasks.length : 0);
    const acceptedTaskMask = normalizeAcceptedTaskMask(input.acceptedTaskMask || input.accepted_task_mask || input.acceptedTasks || input.accepted_tasks, proposalTaskCount);
    const rejectedTaskMask = normalizeRejectedTaskMask(input.rejectedTaskMask || input.rejected_task_mask || input.rejectedTasks || input.rejected_tasks, proposalTaskCount);
    const acceptedFieldMasks = normalizeBundleFieldMaskMap(
        input.acceptedFieldMasks || input.accepted_field_masks || input.acceptedTaskFieldMasks || input.accepted_task_field_masks,
        proposalTaskCount
    );
    const editedFieldMasks = normalizeBundleFieldMaskMap(
        input.editedFieldMasks || input.edited_field_masks || input.editedTaskFieldMasks || input.edited_task_field_masks,
        proposalTaskCount
    );
    const activeImpacts = input.activeImpacts || input.impacts || [];
    const tasks = normalizeBundleTasks(rawTasks, {
        requireFieldMask: true,
        acceptedFieldMasks,
        editedFieldMasks,
        proposalTasks
    }).map(task => {
        const impactSelection = normalizeTaskDraftImpactSelection(task.impactIds, activeImpacts);
        return {
            ...task,
            impactIds: impactSelection.impactIds,
            impactFilterReason: impactSelection.filterReason,
            filteredImpactCount: impactSelection.filteredImpactCount,
            rejectedImpactIds: impactSelection.rejectedImpactIds
        };
    });
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey || input.idempotency_key);
    const userId = Number(input.userId || input.user?.id || 0);
    if (!Number.isInteger(userId) || userId <= 0) throw bundleCommitError('Valid user is required.', 401, 'TASK_AI_DRAFT_USER_REQUIRED');
    validateTaskMasks({ acceptedTaskMask, rejectedTaskMask, taskCount: tasks.length, proposalTaskCount });

    const tokenPayload = verifyProposalToken(input.proposalToken || input.proposal_token, {
        secret: options.proposalSecret || options.safetySecret,
        userId,
        businessScope: input.businessScope,
        audience: TASK_AI_DRAFT_BUNDLE_COMMIT_AUDIENCE,
        decision: 'task_bundle',
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
        acceptedFieldMasks: acceptedTaskMask.map(index => ({ proposalIndex: index, fields: acceptedFieldMasks.get(index) || [] })),
        editedFieldMasks: acceptedTaskMask.map(index => ({ proposalIndex: index, fields: editedFieldMasks.get(index) || [] })),
        rejectedImpactIds: tasks.map((task, index) => ({ proposalIndex: index, ids: task.rejectedImpactIds || [] })),
        idempotencyKey,
        proposalHash: submittedProposalHash,
        draftFingerprint: tokenPayload.draftFingerprint,
        catalogVersion
    });

    const client = await db.connect();
    const afterCommit = [];
    const businessContext = input.businessScope?.businessContext || input.businessScope?.business_context || 'event_genix';
    const correlationId = bundleCorrelationId({
        userId,
        businessContext,
        idempotencyKey,
        bundleId,
        proposalHash: submittedProposalHash
    });
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
                reasoningEffort: TASK_AI_DRAFT_REASONING_EFFORT,
                correlationId,
                reasonCode: 'idempotent_replay',
                userHash: tokenPayload.proposalId || tokenPayload.proposalHash,
                businessContext,
                taskCount: Number(existing.task_count || 0),
                acceptedTaskCount: Array.isArray(existing.accepted_task_mask) ? existing.accepted_task_mask.length : 0,
                rejectedTaskCount: Array.isArray(existing.rejected_task_mask) ? existing.rejected_task_mask.length : 0,
                replay: true
            }, options.telemetry);
            return replayed;
        }

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
                date: finalTask.scheduleDate,
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
                task_kind: finalTask.subtasks.length ? 'checklist' : 'action',
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

            const subtasks = finalTask.subtasks.length
                ? await replaceTaskSubtasks(client, task.id, finalTask.subtasks, { sourceType: 'ai' })
                : [];
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
                subtask_count: subtasks.length,
                subtask_done_count: subtasks.filter(item => item.isDone || item.is_done).length,
                subtasks
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
                    filteredImpactCount: finalTask.filteredImpactCount || 0,
                    subtaskCount: finalTask.subtasks.length,
                    scheduleWritten: Boolean(finalTask.scheduleDate)
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
                    ...releaseTelemetryMetadata(),
                    correlationId: safeTelemetryCorrelationId(correlationId, 'task', index),
                    contractVersion: TASK_AI_DRAFT_CONTRACT_VERSION,
                    promptVersion: TASK_AI_DRAFT_PROMPT_VERSION,
                    reasoningEffort: TASK_AI_DRAFT_REASONING_EFFORT,
                    acceptedFieldMask: finalTask.acceptedFieldMask,
                    editedFieldMask: finalTask.editedFieldMask,
                    impactFilterReason: finalTask.impactFilterReason || '',
                    filteredImpactCount: finalTask.filteredImpactCount || 0,
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
                ...releaseTelemetryMetadata(),
                correlationId,
                contractVersion: TASK_AI_DRAFT_CONTRACT_VERSION,
                promptVersion: TASK_AI_DRAFT_PROMPT_VERSION,
                reasoningEffort: TASK_AI_DRAFT_REASONING_EFFORT,
                acceptedFieldMasks: acceptedTaskMask.map(index => ({ proposalIndex: index, fields: acceptedFieldMasks.get(index) || [] })),
                editedFieldMasks: acceptedTaskMask.map(index => ({ proposalIndex: index, fields: editedFieldMasks.get(index) || [] })),
                impactFilterReason: tasks.some(task => task.impactFilterReason) ? 'filter_known_active' : '',
                filteredImpactCount: tasks.reduce((sum, task) => sum + (task.filteredImpactCount || 0), 0),
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
            reasoningEffort: TASK_AI_DRAFT_REASONING_EFFORT,
            correlationId,
            reasonCode: 'bundle_committed',
            userHash: tokenPayload.proposalId || tokenPayload.proposalHash,
            businessContext,
            taskCount: taskIds.length,
            acceptedTaskCount: acceptedTaskMask.length,
            rejectedTaskCount: rejectedTaskMask.length,
            editedTaskCount: tasks.filter(task => task.userEdited).length,
            impactFilterReason: tasks.some(task => task.impactFilterReason) ? 'filter_known_active' : '',
            filteredImpactCount: tasks.reduce((sum, task) => sum + (task.filteredImpactCount || 0), 0),
            replay: false
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
            reasoningEffort: TASK_AI_DRAFT_REASONING_EFFORT,
            correlationId,
            reasonCode: error?.code || 'TASK_AI_BUNDLE_COMMIT_FAILED',
            businessContext: input.businessScope?.businessContext || input.businessScope?.business_context || '',
            taskCount: tasks.length,
            acceptedTaskCount: acceptedTaskMask.length,
            rejectedTaskCount: rejectedTaskMask.length,
            editedTaskCount: tasks.filter(task => task.userEdited).length,
            errorCategory: error?.code || 'TASK_AI_BUNDLE_COMMIT_FAILED'
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

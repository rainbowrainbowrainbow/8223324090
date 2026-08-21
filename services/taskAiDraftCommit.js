'use strict';

const crypto = require('node:crypto');

const { pool } = require('../db');
const { TASK_ACTION_TYPES, logTaskActionEvent } = require('./taskActionHistory');
const { replaceTaskClassification } = require('./myDayTaxonomy');
const { replaceTaskSubtasks } = require('./taskSubtasks');
const { normalizeDraftItems } = require('./taskDecomposition');
const { MY_DAY_TASK_AI_MODEL, compactString } = require('./myDayTaskOpenAIClient');
const { getAssignableTaskOwner } = require('./taskExecution');
const { recordTaskAiDraftTelemetry } = require('./taskAiDraftTelemetry');
const {
    TASK_AI_DRAFT_CONTRACT_VERSION,
    TASK_AI_DRAFT_SINGLE_COMMIT_AUDIENCE,
    TASK_AI_DRAFT_PROMPT_VERSION,
    activeImpactCatalogVersion,
    normalizeDraftSnapshot,
    normalizeScheduleDate,
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

const MAX_COMMIT_TITLE_CHARS = 180;
const MAX_COMMIT_DESCRIPTION_CHARS = 700;
const MAX_COMMIT_SUBTASKS = 7;
const AI_DRAFT_COMMIT_SOURCE_SURFACE = 'task_ai_draft_commit';
const AI_DRAFT_COMMIT_SOURCE_TYPE = 'ai_draft';
const REVIEWED_SINGLE_FIELDS = Object.freeze(['title', 'description', 'mode', 'impactIds', 'subtasks', 'scheduleDate', 'priority']);
const ACCEPTED_FIELD_ALLOWLIST = Object.freeze(['title', 'description', 'mode', 'impactIds', 'subtasks', 'scheduleDate', 'priority', 'owner', 'visibility', 'workflow']);
const ACCEPTED_FIELD_ALIASES = Object.freeze({
    schedule: 'scheduleDate',
    dueDate: 'scheduleDate',
    date: 'scheduleDate',
    ownerUserId: 'owner',
    owner_user_id: 'owner',
    assigned_to: 'owner',
    workflowState: 'workflow',
    workflow_state: 'workflow'
});
const COMMIT_PRIORITIES = Object.freeze(['urgent', 'high', 'normal', 'low']);
const COMMIT_VISIBILITIES = Object.freeze(['team', 'private', 'me_only']);
const COMMIT_WORKFLOWS = Object.freeze(['inbox', 'todo', 'waiting', 'scheduled', 'in_progress']);

function commitError(message, statusCode, code) {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    return error;
}

function legacyTaskTextRef(value, fallback = null) {
    const compacted = compactString(value, 50);
    return compacted || fallback;
}

function safeRecordCommitTelemetry(event = {}, options = {}) {
    try {
        return recordTaskAiDraftTelemetry(event, options);
    } catch {
        return null;
    }
}

function normalizeIdempotencyKey(value) {
    const key = String(value || '').trim();
    if (!key || key.length > 160) {
        throw commitError('Valid idempotency key is required.', 400, 'TASK_AI_DRAFT_IDEMPOTENCY_REQUIRED');
    }
    return key;
}

function normalizeAcceptedFieldMask(value) {
    const raw = Array.isArray(value) ? value : [];
    const fields = [...new Set(raw
        .map(item => String(item || '').trim())
        .filter(Boolean)
        .map(field => ACCEPTED_FIELD_ALIASES[field] || field))];
    const unsupported = fields.filter(field => !ACCEPTED_FIELD_ALLOWLIST.includes(field));
    if (unsupported.length) {
        throw commitError('Accepted field mask contains unsupported fields.', 400, 'TASK_AI_DRAFT_FIELD_MASK_INVALID');
    }
    return fields;
}

function normalizeEditedFieldMask(value) {
    return normalizeAcceptedFieldMask(value);
}

function normalizeMode(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'checklist') return 'checklist';
    if (raw === 'simple' || raw === 'action') return 'simple';
    return 'simple';
}

function truthy(value) {
    return value === true || value === 'true' || value === '1' || value === 1 || value === 'yes' || value === 'on';
}

function normalizeEnum(value, allowed, fallback, fieldName) {
    const raw = String(value || fallback || '').trim().toLowerCase();
    if (allowed.includes(raw)) return raw;
    throw commitError(`${fieldName} is invalid.`, 400, `TASK_AI_DRAFT_${fieldName.toUpperCase()}_INVALID`);
}

function normalizeOptionalOwnerUserId(value, { required = false } = {}) {
    const raw = value === undefined || value === null || value === '' ? null : Number(value);
    if (raw === null) {
        if (required) throw commitError('Owner confirmation is invalid.', 400, 'TASK_AI_DRAFT_OWNER_INVALID');
        return null;
    }
    if (!Number.isInteger(raw) || raw <= 0) {
        throw commitError('Owner confirmation is invalid.', 400, 'TASK_AI_DRAFT_OWNER_INVALID');
    }
    return raw;
}

function safeNormalizeSignedDraftSnapshot(value = {}) {
    try {
        return normalizeDraftSnapshot(value || {});
    } catch {
        return normalizeDraftSnapshot({});
    }
}

function hasReviewedField(field, acceptedFields, editedFields) {
    return acceptedFields.has(field) || editedFields.has(field);
}

function normalizeReviewedDescription({ draft, signedDraftSnapshot, title, reviewed }) {
    if (reviewed) return normalizeTaskDraftDescription(draft.description, draft, title);
    const description = normalizeTaskDraftDescription(signedDraftSnapshot.description, {}, '');
    return description || null;
}

function normalizeReviewedSubtasks(value = []) {
    return normalizeDraftItems(Array.isArray(value) ? value : [], {
        sourceType: 'ai',
        maxItems: MAX_COMMIT_SUBTASKS
    });
}

function normalizeFinalDraft(value = {}, options = {}) {
    const draft = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const acceptedFields = new Set(normalizeAcceptedFieldMask(options.acceptedFieldMask || []));
    const editedFields = new Set(normalizeEditedFieldMask(options.editedFieldMask || []));
    const signedDraftSnapshot = safeNormalizeSignedDraftSnapshot(options.signedDraftSnapshot || {});
    const title = hasReviewedField('title', acceptedFields, editedFields)
        ? normalizeTaskDraftTitle(draft.title, draft)
        : (normalizeTaskDraftTitle(signedDraftSnapshot.title, signedDraftSnapshot) || normalizeTaskDraftTitle(draft.title, draft));
    if (!title) throw commitError('Task title is required.', 400, 'TASK_AI_DRAFT_TITLE_REQUIRED');
    const description = normalizeReviewedDescription({
        draft,
        signedDraftSnapshot,
        title,
        reviewed: hasReviewedField('description', acceptedFields, editedFields)
    });
    const mode = hasReviewedField('mode', acceptedFields, editedFields)
        ? normalizeMode(draft.structuralMode || draft.structural_mode || draft.mode || draft.taskKind || draft.task_kind || draft.kind)
        : normalizeMode(signedDraftSnapshot.mode || signedDraftSnapshot.taskKind || signedDraftSnapshot.task_kind || signedDraftSnapshot.kind);
    const subtasks = hasReviewedField('subtasks', acceptedFields, editedFields)
        ? normalizeReviewedSubtasks(draft.subtasks)
        : normalizeReviewedSubtasks(signedDraftSnapshot.subtasks);
    const impactIds = hasReviewedField('impactIds', acceptedFields, editedFields)
        ? normalizeTaskDraftImpactIds(draft.impactIds ?? draft.impact_ids ?? [])
        : normalizeTaskDraftImpactIds(signedDraftSnapshot.impactIds ?? signedDraftSnapshot.impact_ids ?? []);
    const scheduleConfirmed = truthy(draft.scheduleConfirmed ?? draft.schedule_confirmed ?? draft.confirmSchedule ?? draft.confirm_schedule);
    const scheduleDate = acceptedFields.has('scheduleDate') && scheduleConfirmed
        ? normalizeScheduleDate(draft.scheduleDate)
        : null;
    const deadline = scheduleDate && draft.deadline
        ? String(draft.deadline).trim()
        : null;
    const priority = acceptedFields.has('priority')
        ? normalizeEnum(draft.priority, COMMIT_PRIORITIES, 'normal', 'priority')
        : 'normal';
    const ownerUserId = acceptedFields.has('owner')
        ? normalizeOptionalOwnerUserId(draft.ownerUserId ?? draft.owner_user_id ?? draft.assignedToUserId ?? draft.assigned_to_user_id, { required: true })
        : Number(options.defaultOwnerUserId || 0);
    const visibility = acceptedFields.has('visibility')
        ? normalizeEnum(draft.visibility, COMMIT_VISIBILITIES, 'team', 'visibility')
        : (['private', 'personal', 'me_only'].includes(String(draft.taskMode || draft.task_mode || '').trim().toLowerCase()) ? 'private' : 'team');
    const workflowState = acceptedFields.has('workflow')
        ? normalizeEnum(draft.workflowState ?? draft.workflow_state, COMMIT_WORKFLOWS, 'inbox', 'workflow')
        : 'inbox';
    return {
        title,
        description,
        mode,
        taskMode: compactString(draft.taskMode || draft.task_mode || 'work', 60) || 'work',
        taskKind: mode === 'checklist' || subtasks.length ? 'checklist' : 'action',
        category: compactString(draft.category || 'admin', 80) || 'admin',
        subcategory: compactString(draft.subcategory, 80) || null,
        impactIds,
        subtasks,
        scheduleConfirmed,
        scheduleDate,
        deadline,
        priority,
        ownerUserId,
        visibility,
        workflowState
    };
}

function assertEditedFieldsAreReviewed(acceptedFieldMask = [], editedFieldMask = []) {
    const accepted = new Set(acceptedFieldMask);
    const editedWithoutReview = editedFieldMask.filter(field => REVIEWED_SINGLE_FIELDS.includes(field) && !accepted.has(field));
    if (editedWithoutReview.length) {
        throw commitError('Edited AI draft fields must also be accepted.', 400, 'TASK_AI_DRAFT_FIELD_MASK_INVALID');
    }
}

function hashCommitRequest(payload = {}) {
    return crypto.createHash('sha256').update(stableStringify(payload)).digest('base64url');
}

function normalizeSubmittedProposalHash(body = {}) {
    const direct = String(body.proposalHash || body.proposal_hash || '').trim();
    if (direct) return direct;
    if (body.proposal && typeof body.proposal === 'object' && !Array.isArray(body.proposal)) {
        return proposalHash(body.proposal);
    }
    throw commitError('Proposal hash is required.', 400, 'TASK_AI_DRAFT_PROPOSAL_HASH_REQUIRED');
}

function ensureTokenMatchesRequest({ tokenPayload, userId, businessScope, activeImpacts, body, finalDraft }) {
    if (Number(tokenPayload.userId || 0) !== Number(userId || 0)) {
        throw commitError('Proposal token belongs to another user.', 403, 'TASK_AI_DRAFT_TOKEN_USER_MISMATCH');
    }
    const businessContext = businessScope?.businessContext || businessScope?.business_context || null;
    if (businessContext && tokenPayload.businessContext && tokenPayload.businessContext !== businessContext) {
        throw commitError('Proposal token belongs to another business scope.', 403, 'TASK_AI_DRAFT_TOKEN_SCOPE_MISMATCH');
    }
    const submittedDraftFingerprint = String(body.draftFingerprint || body.draft_fingerprint || body.baseDraftFingerprint || body.base_draft_fingerprint || '').trim();
    if (!submittedDraftFingerprint) {
        throw commitError('Draft fingerprint is required.', 400, 'TASK_AI_DRAFT_FINGERPRINT_REQUIRED');
    }
    if (submittedDraftFingerprint !== tokenPayload.draftFingerprint) {
        throw commitError('Draft fingerprint does not match proposal token.', 409, 'TASK_AI_DRAFT_FINGERPRINT_CONFLICT');
    }
    const submittedProposalHash = normalizeSubmittedProposalHash(body);
    if (submittedProposalHash !== tokenPayload.proposalHash) {
        throw commitError('Proposal hash does not match proposal token.', 409, 'TASK_AI_DRAFT_PROPOSAL_CONFLICT');
    }
    const catalogVersion = activeImpactCatalogVersion(activeImpacts);
    if (tokenPayload.catalogVersion && tokenPayload.catalogVersion !== catalogVersion) {
        throw commitError('Impact catalog changed after preview.', 409, 'TASK_AI_DRAFT_CATALOG_CHANGED');
    }
    return { submittedProposalHash, catalogVersion };
}

function normalizeSubmittedProposalForReviewedFields(body = {}) {
    if (!body.proposal || typeof body.proposal !== 'object' || Array.isArray(body.proposal)) return null;
    try {
        return {
            priority: body.proposal.priority === null || body.proposal.priority === undefined || body.proposal.priority === ''
                ? null
                : normalizeEnum(body.proposal.priority, COMMIT_PRIORITIES, 'normal', 'priority'),
            scheduleDate: normalizeScheduleDate(body.proposal.scheduleDate)
        };
    } catch {
        throw commitError('Submitted proposal is invalid.', 400, 'TASK_AI_DRAFT_PROPOSAL_INVALID');
    }
}

function assertReviewedScheduleAndPriorityMatchProposal({ finalDraft, body, acceptedFieldMask = [], editedFieldMask = [] }) {
    const acceptedFields = new Set(normalizeAcceptedFieldMask(acceptedFieldMask));
    const editedFields = new Set(normalizeEditedFieldMask(editedFieldMask));
    const needsProposal = ['scheduleDate', 'priority'].some(field => acceptedFields.has(field) && !editedFields.has(field));
    if (!needsProposal) return;
    const submittedProposal = normalizeSubmittedProposalForReviewedFields(body);
    if (!submittedProposal) {
        throw commitError('Reviewed AI fields require the signed proposal body.', 400, 'TASK_AI_DRAFT_PROPOSAL_REQUIRED');
    }
    if (acceptedFields.has('scheduleDate') && !editedFields.has('scheduleDate')) {
        const expectedScheduleDate = normalizeScheduleDate(submittedProposal.scheduleDate);
        if (finalDraft.scheduleDate !== expectedScheduleDate) {
            throw commitError('Task schedule changed after AI preview.', 409, 'TASK_AI_DRAFT_SCHEDULE_CONFLICT');
        }
    }
    if (acceptedFields.has('priority') && !editedFields.has('priority')) {
        const expectedPriority = submittedProposal.priority === null
            ? 'normal'
            : normalizeEnum(submittedProposal.priority, COMMIT_PRIORITIES, 'normal', 'priority');
        if (finalDraft.priority !== expectedPriority) {
            throw commitError('Task priority changed after AI preview.', 409, 'TASK_AI_DRAFT_PRIORITY_CONFLICT');
        }
    }
}

async function findCommittedReplay(client, { userId, idempotencyKey, businessScope }) {
    const params = [
        TASK_ACTION_TYPES.AI_DRAFT_COMMITTED,
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
        `SELECT h.*, t.*
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

function replayResponse(row = {}) {
    return {
        ok: true,
        replayed: true,
        task: row,
        historyEvent: {
            id: row.id,
            taskId: row.task_id,
            actionType: row.action_type,
            meta: row.meta_json || null,
            createdAt: row.created_at || null
        }
    };
}

async function commitTaskAiDraft(input = {}, options = {}) {
    const startedAt = Date.now();
    const db = options.pool || pool;
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey || input.idempotency_key);
    const acceptedFieldMask = normalizeAcceptedFieldMask(input.acceptedFieldMask || input.accepted_field_mask || input.acceptedFields || input.accepted_fields);
    const editedFieldMask = normalizeEditedFieldMask(input.editedFieldMask || input.edited_field_mask || input.editedFields || input.edited_fields);
    assertEditedFieldsAreReviewed(acceptedFieldMask, editedFieldMask);
    const userId = Number(input.userId || input.user?.id || 0);
    if (!Number.isInteger(userId) || userId <= 0) throw commitError('Valid user is required.', 401, 'TASK_AI_DRAFT_USER_REQUIRED');
    const tokenPayload = verifyProposalToken(input.proposalToken || input.proposal_token, {
        secret: options.proposalSecret || options.safetySecret,
        userId,
        businessScope: input.businessScope,
        audience: TASK_AI_DRAFT_SINGLE_COMMIT_AUDIENCE,
        allowedDecisions: ['single_task', 'checklist'],
        now: options.now
    });
    const finalDraft = normalizeFinalDraft(input.finalDraft || input.draft || {}, {
        acceptedFieldMask,
        editedFieldMask,
        signedDraftSnapshot: tokenPayload.draftSnapshot,
        defaultOwnerUserId: userId
    });
    const impactSelection = normalizeTaskDraftImpactSelection(finalDraft.impactIds, input.activeImpacts || input.impacts || []);
    finalDraft.impactIds = impactSelection.impactIds;
    assertReviewedScheduleAndPriorityMatchProposal({
        finalDraft,
        body: input,
        acceptedFieldMask,
        editedFieldMask
    });
    const { submittedProposalHash, catalogVersion } = ensureTokenMatchesRequest({
        tokenPayload,
        userId,
        businessScope: input.businessScope,
        activeImpacts: input.activeImpacts || input.impacts || [],
        body: input,
        finalDraft
    });
    const requestHash = hashCommitRequest({
        finalDraft,
        acceptedFieldMask,
        editedFieldMask,
        rejectedImpactIds: impactSelection.rejectedImpactIds,
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
            `task_ai_draft_commit:${tokenPayload.proposalId || tokenPayload.proposalHash}`
        ]);
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [
            `task_ai_draft_idempotency:${userId}:${input.businessScope?.businessContext || input.businessScope?.business_context || 'event_genix'}:${idempotencyKey}`
        ]);

        const existing = await findCommittedReplay(client, { userId, idempotencyKey, businessScope: input.businessScope });
            if (existing) {
                const meta = existing.meta_json || {};
                if (meta.requestHash && meta.requestHash !== requestHash) {
                    throw commitError('Idempotency key was already used with a different request.', 409, 'TASK_AI_DRAFT_IDEMPOTENCY_CONFLICT');
                }
                await client.query('COMMIT');
                safeRecordCommitTelemetry({
                    type: 'commit',
                    status: 'replayed',
                    latencyMs: Date.now() - startedAt,
                    model: MY_DAY_TASK_AI_MODEL,
                    contractVersion: TASK_AI_DRAFT_CONTRACT_VERSION,
                    promptVersion: TASK_AI_DRAFT_PROMPT_VERSION,
                    reasonCode: 'idempotent_replay',
                    userHash: tokenPayload.proposalId || tokenPayload.proposalHash,
                    businessContext: input.businessScope?.businessContext || input.businessScope?.business_context || '',
                    acceptedFieldMask,
                    editedFieldMask
                }, options.telemetry);
                return replayResponse(existing);
            }

        const createTaskImpl = options.createTaskImpl || require('./kleshnya').createTask;
        const actorLabel = legacyTaskTextRef(input.user?.username || input.user?.name, 'ai-draft');
        const ownerLabel = legacyTaskTextRef(input.user?.username || input.user?.name, null);
        const sourceId = legacyTaskTextRef(tokenPayload.proposalId || tokenPayload.proposalHash, null);
        const resolveOwner = options.getAssignableTaskOwnerImpl || getAssignableTaskOwner;
        const requestedOwnerId = Number(finalDraft.ownerUserId || userId);
        const ownerRecord = requestedOwnerId === userId
            ? {
                id: userId,
                label: ownerLabel || actorLabel
            }
            : await resolveOwner(requestedOwnerId, { pool: client, actor: input.user });
        const task = await createTaskImpl({
            businessContext: input.businessScope?.businessContext || input.businessScope?.business_context || undefined,
            title: finalDraft.title,
            description: finalDraft.description || null,
            date: finalDraft.scheduleDate,
            deadline: finalDraft.deadline,
            priority: finalDraft.priority,
            assigned_to: ownerRecord.label,
            owner_user_id: ownerRecord.id,
            owner: ownerRecord.label,
            task_type: 'human',
            dependency_ids: [],
            source_type: AI_DRAFT_COMMIT_SOURCE_TYPE,
            source_id: sourceId,
            category: finalDraft.category,
            subcategory: finalDraft.subcategory,
            created_by: actorLabel,
            created_by_user_id: userId,
            task_mode: finalDraft.taskMode,
            task_kind: finalDraft.taskKind,
            visibility: finalDraft.visibility,
            workflow_state: finalDraft.workflowState,
            source_module: 'tasks_ai_draft_commit',
            control_meta: {
                aiDraft: {
                    contractVersion: TASK_AI_DRAFT_CONTRACT_VERSION,
                    promptVersion: TASK_AI_DRAFT_PROMPT_VERSION
                }
            },
            duplicateMode: 'reject'
        }, {
            pool: client,
            skipNotifications: true,
            skipHermesOutbox: true,
            afterCommit
        });

        const subtasks = finalDraft.subtasks.length
            ? await replaceTaskSubtasks(client, task.id, finalDraft.subtasks, { sourceType: 'ai' })
            : [];
        const classification = await replaceTaskClassification(client, {
            userId,
            taskId: task.id,
            impactIds: finalDraft.impactIds
        });
        const historyEvent = await logTaskActionEvent({
            taskId: task.id,
            actionType: TASK_ACTION_TYPES.AI_DRAFT_COMMITTED,
            actor: input.user,
            sourceSurface: input.sourceSurface || AI_DRAFT_COMMIT_SOURCE_SURFACE,
            oldValue: null,
            newValue: {
                taskId: Number(task.id),
                changedFields: acceptedFieldMask,
                impactCount: finalDraft.impactIds.length,
                filteredImpactCount: impactSelection.filteredImpactCount,
                subtaskCount: subtasks.length,
                scheduleWritten: Boolean(finalDraft.scheduleDate || finalDraft.deadline)
            },
            meta: {
                idempotencyKey,
                requestHash,
                proposalId: tokenPayload.proposalId || null,
                proposalHash: submittedProposalHash,
                draftFingerprint: tokenPayload.draftFingerprint,
                catalogVersion,
                contractVersion: TASK_AI_DRAFT_CONTRACT_VERSION,
                promptVersion: TASK_AI_DRAFT_PROMPT_VERSION,
                provider: 'openai',
                model: MY_DAY_TASK_AI_MODEL,
                acceptedFieldMask,
                editedFieldMask,
                impactFilterReason: impactSelection.filterReason,
                filteredImpactCount: impactSelection.filteredImpactCount,
                source: AI_DRAFT_COMMIT_SOURCE_SURFACE,
                rawPromptStored: false,
                rawProviderResponseStored: false
            },
            summary: 'AI-assisted task draft committed'
        }, { pool: client });

        await client.query('COMMIT');
        safeRecordCommitTelemetry({
            type: 'commit',
            status: 'success',
            latencyMs: Date.now() - startedAt,
            model: MY_DAY_TASK_AI_MODEL,
            contractVersion: TASK_AI_DRAFT_CONTRACT_VERSION,
            promptVersion: TASK_AI_DRAFT_PROMPT_VERSION,
            reasonCode: 'committed',
            userHash: tokenPayload.proposalId || tokenPayload.proposalHash,
            businessContext: input.businessScope?.businessContext || input.businessScope?.business_context || '',
            changedFields: acceptedFieldMask,
            acceptedFieldMask,
            editedFieldMask,
            impactFilterReason: impactSelection.filterReason,
            filteredImpactCount: impactSelection.filteredImpactCount
        }, options.telemetry);
        return {
            ok: true,
            replayed: false,
            task: {
                ...task,
                subtask_count: subtasks.length,
                subtask_done_count: subtasks.filter(item => item.isDone || item.is_done).length,
                subtasks
            },
            subtasks,
            classification,
            historyEvent
        };
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch {}
        safeRecordCommitTelemetry({
            type: 'commit',
            status: error?.statusCode === 409 ? 'conflict' : 'rollback',
            latencyMs: Date.now() - startedAt,
            model: MY_DAY_TASK_AI_MODEL,
            contractVersion: TASK_AI_DRAFT_CONTRACT_VERSION,
            promptVersion: TASK_AI_DRAFT_PROMPT_VERSION,
            reasonCode: error?.code || 'TASK_AI_DRAFT_COMMIT_FAILED',
            businessContext: input.businessScope?.businessContext || input.businessScope?.business_context || '',
            acceptedFieldMask,
            editedFieldMask
        }, options.telemetry);
        throw error;
    } finally {
        client.release();
    }
}

module.exports = {
    ACCEPTED_FIELD_ALLOWLIST,
    AI_DRAFT_COMMIT_SOURCE_SURFACE,
    AI_DRAFT_COMMIT_SOURCE_TYPE,
    commitTaskAiDraft,
    hashCommitRequest,
    legacyTaskTextRef,
    normalizeAcceptedFieldMask,
    normalizeEditedFieldMask,
    normalizeFinalDraft,
    normalizeIdempotencyKey
};

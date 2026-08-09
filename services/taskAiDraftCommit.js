'use strict';

const crypto = require('node:crypto');

const { pool } = require('../db');
const { TASK_ACTION_TYPES, logTaskActionEvent } = require('./taskActionHistory');
const { replaceTaskClassification, normalizeImpactIds } = require('./myDayTaxonomy');
const { replaceTaskSubtasks } = require('./taskSubtasks');
const { normalizeDraftItems } = require('./taskDecomposition');
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

const MAX_COMMIT_TITLE_CHARS = 180;
const MAX_COMMIT_DESCRIPTION_CHARS = 700;
const MAX_COMMIT_SUBTASKS = 7;
const AI_DRAFT_COMMIT_SOURCE_SURFACE = 'task_ai_draft_commit';
const AI_DRAFT_COMMIT_SOURCE_TYPE = 'ai_draft';
const ACCEPTED_FIELD_ALLOWLIST = Object.freeze(['title', 'description', 'mode', 'impactIds', 'subtasks', 'schedule']);

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
    const fields = [...new Set(raw.map(item => String(item || '').trim()).filter(Boolean))];
    const unsupported = fields.filter(field => !ACCEPTED_FIELD_ALLOWLIST.includes(field));
    if (unsupported.length) {
        throw commitError('Accepted field mask contains unsupported fields.', 400, 'TASK_AI_DRAFT_FIELD_MASK_INVALID');
    }
    return fields;
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

function normalizeFinalDraft(value = {}) {
    const draft = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const title = compactString(draft.title, MAX_COMMIT_TITLE_CHARS);
    if (!title) throw commitError('Task title is required.', 400, 'TASK_AI_DRAFT_TITLE_REQUIRED');
    const description = compactString(draft.description, MAX_COMMIT_DESCRIPTION_CHARS);
    const mode = normalizeMode(draft.mode || draft.taskMode || draft.task_mode || draft.taskKind || draft.task_kind);
    const subtasks = normalizeDraftItems(Array.isArray(draft.subtasks) ? draft.subtasks : [], {
        sourceType: 'ai',
        maxItems: MAX_COMMIT_SUBTASKS
    });
    const impactIds = normalizeImpactIds(draft.impactIds ?? draft.impact_ids ?? []);
    const scheduleConfirmed = truthy(draft.scheduleConfirmed ?? draft.schedule_confirmed ?? draft.confirmSchedule ?? draft.confirm_schedule);
    const date = scheduleConfirmed && /^\d{4}-\d{2}-\d{2}$/.test(String(draft.date || '').trim())
        ? String(draft.date).trim()
        : null;
    const deadline = scheduleConfirmed && draft.deadline
        ? String(draft.deadline).trim()
        : null;
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
        date,
        deadline
    };
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

function ensureTokenMatchesRequest({ tokenPayload, userId, businessScope, activeImpacts, body }) {
    if (Number(tokenPayload.userId || 0) !== Number(userId || 0)) {
        throw commitError('Proposal token belongs to another user.', 403, 'TASK_AI_DRAFT_TOKEN_USER_MISMATCH');
    }
    const businessContext = businessScope?.businessContext || businessScope?.business_context || null;
    if (businessContext && tokenPayload.businessContext && tokenPayload.businessContext !== businessContext) {
        throw commitError('Proposal token belongs to another business scope.', 403, 'TASK_AI_DRAFT_TOKEN_SCOPE_MISMATCH');
    }
    const submittedDraftFingerprint = String(body.draftFingerprint || body.draft_fingerprint || body.baseDraftFingerprint || body.base_draft_fingerprint || '').trim();
    if (submittedDraftFingerprint && submittedDraftFingerprint !== tokenPayload.draftFingerprint) {
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
    const finalDraft = normalizeFinalDraft(input.finalDraft || input.draft || {});
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey || input.idempotency_key);
    const acceptedFieldMask = normalizeAcceptedFieldMask(input.acceptedFieldMask || input.accepted_field_mask || input.acceptedFields || input.accepted_fields);
    const userId = Number(input.userId || input.user?.id || 0);
    if (!Number.isInteger(userId) || userId <= 0) throw commitError('Valid user is required.', 401, 'TASK_AI_DRAFT_USER_REQUIRED');

    const tokenPayload = verifyProposalToken(input.proposalToken || input.proposal_token, {
        secret: options.proposalSecret || options.safetySecret,
        userId,
        businessScope: input.businessScope,
        now: options.now
    });
    const { submittedProposalHash, catalogVersion } = ensureTokenMatchesRequest({
        tokenPayload,
        userId,
        businessScope: input.businessScope,
        activeImpacts: input.activeImpacts || input.impacts || [],
        body: input
    });
    const requestHash = hashCommitRequest({
        finalDraft,
        acceptedFieldMask,
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
                    acceptedFieldMask
                }, options.telemetry);
                return replayResponse(existing);
            }

        const createTaskImpl = options.createTaskImpl || require('./kleshnya').createTask;
        const actorLabel = legacyTaskTextRef(input.user?.username || input.user?.name, 'ai-draft');
        const ownerLabel = legacyTaskTextRef(input.user?.username || input.user?.name, null);
        const sourceId = legacyTaskTextRef(tokenPayload.proposalId || tokenPayload.proposalHash, null);
        const task = await createTaskImpl({
            businessContext: input.businessScope?.businessContext || input.businessScope?.business_context || undefined,
            title: finalDraft.title,
            description: finalDraft.description || null,
            date: finalDraft.date,
            deadline: finalDraft.deadline,
            priority: 'normal',
            assigned_to: ownerLabel,
            owner_user_id: userId,
            owner: ownerLabel,
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
            visibility: finalDraft.taskMode === 'private' || finalDraft.taskMode === 'personal' ? 'private' : 'team',
            workflow_state: 'inbox',
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
                subtaskCount: subtasks.length,
                scheduleWritten: Boolean(finalDraft.date || finalDraft.deadline)
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
            acceptedFieldMask
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
            acceptedFieldMask
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
    normalizeFinalDraft,
    normalizeIdempotencyKey
};

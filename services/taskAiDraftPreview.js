'use strict';

const crypto = require('node:crypto');

const { MAX_IMPACTS_PER_TASK, normalizeImpactIds } = require('./myDayTaxonomy');
const { guidanceForImpactName } = require('./myDayImpactCatalog');
const { normalizeDraftItems } = require('./taskDecomposition');
const {
    MY_DAY_TASK_AI_MODEL,
    callMyDayTaskOpenAIResponses,
    compactString,
    extractOpenAIResponseObject,
    hmacSafetyIdentifier,
    parseAiJson,
    resolveTimeoutMs
} = require('./myDayTaskOpenAIClient');
const { recordTaskAiDraftTelemetry } = require('./taskAiDraftTelemetry');

const TASK_AI_DRAFT_CONTRACT_VERSION = 'my_day_ai_composer_proposal_v1';
const TASK_AI_DRAFT_SCHEMA_NAME = 'my_day_task_draft_preview';
const TASK_AI_DRAFT_PROMPT_VERSION = '2026-08-09.1';
const TASK_AI_DRAFT_TIMEOUT_MS = 15_000;
const TASK_AI_DRAFT_MAX_OUTPUT_TOKENS = 900;
const TASK_AI_DRAFT_REASONING_EFFORT = 'low';
const TASK_AI_DRAFT_TOKEN_TTL_MS = 10 * 60 * 1000;
const MAX_TITLE_CHARS = 180;
const MAX_DESCRIPTION_CHARS = 700;
const MAX_REASON_CHARS = 180;
const MAX_SUBTASKS = 7;
const MAX_ACTIVE_IMPACTS_FOR_PROMPT = 80;
const PREVIEW_ACTIONS = Object.freeze(['apply', 'needs_clarification', 'needs_project', 'no_change']);
const PREVIEW_MODES = Object.freeze(['simple', 'checklist', null]);

const TASK_AI_DRAFT_PREVIEW_SCHEMA = Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['action', 'mode', 'title', 'description', 'impactIds', 'subtasks', 'confidence', 'reason'],
    properties: {
        action: { type: 'string', enum: PREVIEW_ACTIONS },
        mode: { type: ['string', 'null'], enum: PREVIEW_MODES },
        title: { type: ['string', 'null'], maxLength: MAX_TITLE_CHARS },
        description: { type: ['string', 'null'], maxLength: MAX_DESCRIPTION_CHARS },
        impactIds: {
            type: 'array',
            maxItems: MAX_IMPACTS_PER_TASK,
            uniqueItems: true,
            items: { type: 'integer' }
        },
        subtasks: {
            type: 'array',
            maxItems: MAX_SUBTASKS,
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['title'],
                properties: {
                    title: { type: 'string', minLength: 3, maxLength: 160 }
                }
            }
        },
        confidence: {
            type: 'object',
            additionalProperties: false,
            required: ['overall', 'title', 'description', 'impacts', 'subtasks', 'mode'],
            properties: {
                overall: { type: 'number', minimum: 0, maximum: 1 },
                title: { type: 'number', minimum: 0, maximum: 1 },
                description: { type: 'number', minimum: 0, maximum: 1 },
                impacts: { type: 'number', minimum: 0, maximum: 1 },
                subtasks: { type: 'number', minimum: 0, maximum: 1 },
                mode: { type: 'number', minimum: 0, maximum: 1 }
            }
        },
        reason: { type: 'string', minLength: 1, maxLength: MAX_REASON_CHARS }
    }
});

function createPreviewError(message, statusCode, code, extra = {}) {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    Object.assign(error, extra);
    return error;
}

function previewTelemetryStatus(result = {}) {
    if (result?.ok) return 'success';
    if (result?.reason === 'timeout' || result?.code === 'TASK_AI_DRAFT_TIMEOUT') return 'timeout';
    if (result?.code === 'TASK_AI_DRAFT_INVALID_RESPONSE' || result?.reason === 'invalid_response') return 'invalid_response';
    if (result?.code === 'TASK_AI_PROVIDER_UNAVAILABLE') return 'provider_unavailable';
    return 'provider_error';
}

function safeRecordPreviewTelemetry(event = {}, options = {}) {
    try {
        return recordTaskAiDraftTelemetry(event, options);
    } catch {
        return null;
    }
}

function normalizeMode(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'checklist') return 'checklist';
    if (raw === 'simple' || raw === 'action') return 'simple';
    return null;
}

function normalizeDraftSnapshot(value = {}) {
    const draft = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const title = compactString(draft.title, MAX_TITLE_CHARS);
    const description = compactString(draft.description, MAX_DESCRIPTION_CHARS);
    const rawImpacts = draft.impactIds ?? draft.impact_ids ?? [];
    let impactIds = [];
    if (Array.isArray(rawImpacts)) {
        impactIds = normalizeImpactIds(rawImpacts);
    }
    return {
        title,
        description,
        mode: normalizeMode(draft.mode || draft.taskMode || draft.task_mode || draft.taskKind || draft.task_kind),
        category: compactString(draft.category, 80),
        subcategory: compactString(draft.subcategory, 80),
        taskKind: compactString(draft.taskKind || draft.task_kind, 60),
        taskMode: compactString(draft.taskMode || draft.task_mode, 60),
        sourceType: compactString(draft.sourceType || draft.source_type, 80),
        sourceModule: compactString(draft.sourceModule || draft.source_module, 80),
        impactIds
    };
}

function activeImpactPayload(impacts = []) {
    return (Array.isArray(impacts) ? impacts : [])
        .filter(impact => impact && impact.isActive !== false)
        .map(impact => {
            const id = Number(impact.id);
            const name = compactString(impact.name, 80);
            const guidance = guidanceForImpactName(name);
            return {
                id,
                name,
                icon: compactString(impact.icon, 16),
                ...(guidance ? { group: guidance.group, hints: [...guidance.hints] } : {})
            };
        })
        .filter(impact => Number.isInteger(impact.id) && impact.id > 0 && impact.name)
        .slice(0, MAX_ACTIVE_IMPACTS_FOR_PROMPT);
}

function activeImpactCatalogVersion(impacts = []) {
    const payload = activeImpactPayload(impacts)
        .map(impact => ({
            id: impact.id,
            name: impact.name,
            icon: impact.icon,
            group: impact.group || null,
            hints: impact.hints || []
        }))
        .sort((a, b) => a.id - b.id);
    return crypto.createHash('sha256').update(stableStringify(payload)).digest('base64url');
}

function stableStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function draftFingerprint(draft = {}) {
    return crypto.createHash('sha256').update(stableStringify(normalizeDraftSnapshot(draft))).digest('base64url');
}

function buildSystemPrompt() {
    return [
        'You prepare a preview proposal for one Event Genix task composer draft.',
        'Return exactly one JSON object that satisfies the provided schema.',
        'One response must decide both My Day impactIds and task structure.',
        'Allowed actions are apply, needs_clarification, needs_project, and no_change.',
        'Use apply only when the draft can be safely improved without inventing facts.',
        'Use needs_clarification when the title or scope is too unclear; do not invent subtasks.',
        'Use needs_project when the input is bigger than one task; do not create projects.',
        'Use no_change when the existing draft is already clear and complete.',
        'Allowed modes are simple, checklist, or null. Use checklist only when useful subtasks are concrete.',
        `Choose at most ${MAX_IMPACTS_PER_TASK} impactIds and only from activeImpacts.`,
        'Never create, rename, or output archived/unknown impact IDs.',
        'Do not output tags, directions, dependencies, owners, status, priority, deadline, permissions, or business scope.',
        'The server will compute the diff and validate all IDs; do not include diff fields.',
        'Keep reason short and non-sensitive.'
    ].join('\n');
}

function buildUserMessage({ draft, impacts }) {
    return JSON.stringify({
        contractVersion: TASK_AI_DRAFT_CONTRACT_VERSION,
        promptVersion: TASK_AI_DRAFT_PROMPT_VERSION,
        currentDraft: normalizeDraftSnapshot(draft),
        activeImpacts: activeImpactPayload(impacts),
        allowlists: {
            actions: PREVIEW_ACTIONS,
            modes: PREVIEW_MODES,
            maxImpacts: MAX_IMPACTS_PER_TASK,
            maxSubtasks: MAX_SUBTASKS,
            maxTitleChars: MAX_TITLE_CHARS,
            maxDescriptionChars: MAX_DESCRIPTION_CHARS
        }
    });
}

function buildOpenAIResponsesInput({ draft, impacts }) {
    return [
        {
            role: 'system',
            content: [{ type: 'input_text', text: buildSystemPrompt() }]
        },
        {
            role: 'user',
            content: [{ type: 'input_text', text: buildUserMessage({ draft, impacts }) }]
        }
    ];
}

function assertStrictProposalKeys(payload = {}) {
    const allowed = new Set(TASK_AI_DRAFT_PREVIEW_SCHEMA.required);
    const extra = Object.keys(payload).filter(key => !allowed.has(key));
    if (extra.length) {
        throw createPreviewError('AI draft proposal contains unsupported fields.', 422, 'TASK_AI_DRAFT_INVALID_RESPONSE');
    }
}

function normalizeConfidence(value = {}) {
    const confidence = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const result = {};
    for (const key of TASK_AI_DRAFT_PREVIEW_SCHEMA.properties.confidence.required) {
        const parsed = Number(confidence[key]);
        if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
            throw createPreviewError('AI draft proposal has invalid confidence.', 422, 'TASK_AI_DRAFT_INVALID_RESPONSE');
        }
        result[key] = parsed;
    }
    const extra = Object.keys(confidence).filter(key => !Object.hasOwn(result, key));
    if (extra.length) {
        throw createPreviewError('AI draft confidence contains unsupported fields.', 422, 'TASK_AI_DRAFT_INVALID_RESPONSE');
    }
    return result;
}

function normalizeProposal(raw = {}, activeImpacts = []) {
    const payload = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    assertStrictProposalKeys(payload);
    const action = String(payload.action || '').trim();
    if (!PREVIEW_ACTIONS.includes(action)) {
        throw createPreviewError('AI draft proposal has invalid action.', 422, 'TASK_AI_DRAFT_INVALID_RESPONSE');
    }

    const mode = payload.mode === null ? null : normalizeMode(payload.mode);
    if (!PREVIEW_MODES.includes(mode)) {
        throw createPreviewError('AI draft proposal has invalid mode.', 422, 'TASK_AI_DRAFT_INVALID_RESPONSE');
    }

    const impactIds = normalizeImpactIds(Array.isArray(payload.impactIds) ? payload.impactIds : null);
    const allowedImpactIds = new Set(activeImpactPayload(activeImpacts).map(impact => impact.id));
    const unknownIds = impactIds.filter(id => !allowedImpactIds.has(id));
    if (unknownIds.length) {
        throw createPreviewError('AI proposed an unavailable impact.', 422, 'TASK_AI_DRAFT_UNKNOWN_IMPACT');
    }

    const title = payload.title === null ? null : compactString(payload.title, MAX_TITLE_CHARS);
    const description = payload.description === null ? null : compactString(payload.description, MAX_DESCRIPTION_CHARS);
    const subtasks = normalizeDraftItems(Array.isArray(payload.subtasks) ? payload.subtasks : [], {
        sourceType: 'ai',
        maxItems: MAX_SUBTASKS
    }).map(item => ({ title: item.title }));
    const confidence = normalizeConfidence(payload.confidence);
    const reason = compactString(payload.reason, MAX_REASON_CHARS);
    if (!reason) {
        throw createPreviewError('AI draft proposal is missing reason.', 422, 'TASK_AI_DRAFT_INVALID_RESPONSE');
    }
    if (action === 'needs_clarification' && subtasks.length) {
        throw createPreviewError('Clarification proposal must not include subtasks.', 422, 'TASK_AI_DRAFT_INVALID_RESPONSE');
    }
    if (action === 'apply' && !title) {
        throw createPreviewError('Apply proposal must include a title.', 422, 'TASK_AI_DRAFT_INVALID_RESPONSE');
    }
    if (mode === 'checklist' && action === 'apply' && subtasks.length < 2) {
        throw createPreviewError('Checklist proposal requires concrete subtasks.', 422, 'TASK_AI_DRAFT_INVALID_RESPONSE');
    }

    return {
        action,
        mode,
        title,
        description,
        impactIds,
        subtasks,
        confidence,
        reason
    };
}

function buildDraftDiff(currentDraft = {}, proposal = {}) {
    const before = normalizeDraftSnapshot(currentDraft);
    const after = {
        title: proposal.title,
        description: proposal.description,
        mode: proposal.mode,
        impactIds: proposal.impactIds || [],
        subtasks: proposal.subtasks || []
    };
    const fields = {};
    for (const field of Object.keys(after)) {
        const beforeValue = field === 'subtasks' ? [] : before[field];
        const afterValue = after[field];
        const changed = stableStringify(beforeValue) !== stableStringify(afterValue);
        fields[field] = { before: beforeValue, after: afterValue, changed };
    }
    return {
        changedFields: Object.entries(fields).filter(([, value]) => value.changed).map(([key]) => key),
        fields
    };
}

function signProposalToken(payload = {}, secret) {
    const stableSecret = String(secret || process.env.JWT_SECRET || '').trim();
    if (!stableSecret) {
        throw createPreviewError('Proposal signing secret is unavailable.', 503, 'TASK_AI_DRAFT_SIGNING_UNAVAILABLE');
    }
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto.createHmac('sha256', stableSecret).update(encodedPayload).digest('base64url');
    return `${encodedPayload}.${signature}`;
}

function proposalHash(proposal = {}) {
    return crypto.createHash('sha256').update(stableStringify(proposal)).digest('base64url');
}

function createProposalToken({ userId, businessScope, fingerprint, proposal, catalogVersion, now = Date.now(), secret }) {
    const hash = proposalHash(proposal);
    return signProposalToken({
        v: 1,
        proposalId: crypto.randomUUID(),
        contractVersion: TASK_AI_DRAFT_CONTRACT_VERSION,
        userId: Number(userId || 0),
        businessContext: businessScope?.businessContext || businessScope?.business_context || null,
        draftFingerprint: fingerprint,
        proposalHash: hash,
        catalogVersion,
        issuedAt: now,
        expiresAt: now + TASK_AI_DRAFT_TOKEN_TTL_MS
    }, secret);
}

function verifyProposalToken(token, options = {}) {
    const stableSecret = String(options.secret || process.env.JWT_SECRET || '').trim();
    if (!stableSecret) {
        throw createPreviewError('Proposal signing secret is unavailable.', 503, 'TASK_AI_DRAFT_SIGNING_UNAVAILABLE');
    }
    const [encodedPayload, signature] = String(token || '').split('.');
    if (!encodedPayload || !signature) {
        throw createPreviewError('Invalid proposal token.', 401, 'TASK_AI_DRAFT_TOKEN_INVALID');
    }
    const expected = crypto.createHmac('sha256', stableSecret).update(encodedPayload).digest('base64url');
    const expectedBuffer = Buffer.from(expected);
    const signatureBuffer = Buffer.from(signature);
    if (expectedBuffer.length !== signatureBuffer.length || !crypto.timingSafeEqual(expectedBuffer, signatureBuffer)) {
        throw createPreviewError('Invalid proposal token.', 401, 'TASK_AI_DRAFT_TOKEN_INVALID');
    }
    let payload;
    try {
        payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    } catch {
        throw createPreviewError('Invalid proposal token.', 401, 'TASK_AI_DRAFT_TOKEN_INVALID');
    }
    const now = Number(options.now || Date.now());
    if (!Number.isFinite(payload.expiresAt) || payload.expiresAt <= now) {
        throw createPreviewError('Proposal token expired.', 409, 'TASK_AI_DRAFT_TOKEN_EXPIRED');
    }
    const userId = Number(options.userId || 0);
    if (userId && Number(payload.userId || 0) !== userId) {
        throw createPreviewError('Proposal token belongs to another user.', 403, 'TASK_AI_DRAFT_TOKEN_USER_MISMATCH');
    }
    const expectedBusinessContext = options.businessScope?.businessContext || options.businessScope?.business_context || null;
    if (expectedBusinessContext && payload.businessContext && payload.businessContext !== expectedBusinessContext) {
        throw createPreviewError('Proposal token belongs to another business scope.', 403, 'TASK_AI_DRAFT_TOKEN_SCOPE_MISMATCH');
    }
    return payload;
}

async function generateTaskAiDraftPreview(input = {}, options = {}) {
    const startedAt = Date.now();
    const draft = normalizeDraftSnapshot(input.draft || input.currentDraft || input);
    const env = options.env || process.env;
    if (!draft.title && !draft.description) {
        const failure = {
            ok: false,
            code: 'TASK_AI_DRAFT_INSUFFICIENT_CONTEXT',
            statusCode: 400,
            reason: 'insufficient_context',
            provider: 'openai',
            model: MY_DAY_TASK_AI_MODEL
        };
        safeRecordPreviewTelemetry({
            type: 'preview',
            status: 'invalid_response',
            latencyMs: Date.now() - startedAt,
            model: MY_DAY_TASK_AI_MODEL,
            contractVersion: TASK_AI_DRAFT_CONTRACT_VERSION,
            promptVersion: TASK_AI_DRAFT_PROMPT_VERSION,
            schemaName: TASK_AI_DRAFT_SCHEMA_NAME,
            reasonCode: failure.code
        }, options.telemetry);
        return failure;
    }

    const impacts = activeImpactPayload(input.impacts || []);
    const fingerprint = draftFingerprint(draft);
    const catalogVersion = activeImpactCatalogVersion(impacts);
    const aiClient = options.openAIClient || options.aiClient || callMyDayTaskOpenAIResponses;
    const safetyIdentifier = options.safetyIdentifier || hmacSafetyIdentifier(input.userId || input.user?.id || '', options.safetySecret);
    const result = await aiClient({
        model: MY_DAY_TASK_AI_MODEL,
        input: buildOpenAIResponsesInput({ draft, impacts }),
        env,
        timeoutMs: options.timeoutMs || resolveTimeoutMs(env.TASK_AI_DRAFT_TIMEOUT_MS, TASK_AI_DRAFT_TIMEOUT_MS),
        schemaName: TASK_AI_DRAFT_SCHEMA_NAME,
        schema: TASK_AI_DRAFT_PREVIEW_SCHEMA,
        reasoningEffort: options.reasoningEffort || env.TASK_AI_DRAFT_REASONING_EFFORT || TASK_AI_DRAFT_REASONING_EFFORT,
        maxOutputTokens: TASK_AI_DRAFT_MAX_OUTPUT_TOKENS,
        safetyIdentifier
    }, options);

    if (!result?.ok) {
        const failure = {
            ok: false,
            code: result?.reason === 'missing_key' || result?.reason === 'auth_failed' || result?.reason === 'fetch_unavailable'
                || result?.reason === 'real_openai_blocked_in_tests'
                ? 'TASK_AI_PROVIDER_UNAVAILABLE'
                : (result?.reason === 'timeout' ? 'TASK_AI_DRAFT_TIMEOUT' : 'TASK_AI_DRAFT_PROVIDER_ERROR'),
            statusCode: result?.statusCode || 503,
            reason: result?.reason || 'provider_error',
            provider: 'openai',
            model: result?.model || MY_DAY_TASK_AI_MODEL
        };
        safeRecordPreviewTelemetry({
            type: 'preview',
            status: previewTelemetryStatus(failure),
            latencyMs: Date.now() - startedAt,
            model: failure.model,
            contractVersion: TASK_AI_DRAFT_CONTRACT_VERSION,
            promptVersion: TASK_AI_DRAFT_PROMPT_VERSION,
            schemaName: TASK_AI_DRAFT_SCHEMA_NAME,
            reasonCode: failure.code,
            userHash: safetyIdentifier,
            businessContext: input.businessScope?.businessContext || input.businessScope?.business_context || '',
            usage: result?.usage || {}
        }, options.telemetry);
        return failure;
    }

    let proposal;
    try {
        proposal = normalizeProposal(
            result.payload ? extractOpenAIResponseObject(result.payload) : parseAiJson(result.text),
            impacts
        );
    } catch (error) {
        const failure = {
            ok: false,
            code: error.code || 'TASK_AI_DRAFT_INVALID_RESPONSE',
            statusCode: error.statusCode || 422,
            reason: error.code || 'invalid_response',
            provider: 'openai',
            model: result.model || MY_DAY_TASK_AI_MODEL
        };
        safeRecordPreviewTelemetry({
            type: 'preview',
            status: 'invalid_response',
            latencyMs: Date.now() - startedAt,
            model: failure.model,
            contractVersion: TASK_AI_DRAFT_CONTRACT_VERSION,
            promptVersion: TASK_AI_DRAFT_PROMPT_VERSION,
            schemaName: TASK_AI_DRAFT_SCHEMA_NAME,
            reasonCode: failure.code,
            userHash: safetyIdentifier,
            businessContext: input.businessScope?.businessContext || input.businessScope?.business_context || '',
            usage: result.usage || {}
        }, options.telemetry);
        return failure;
    }

    const diff = buildDraftDiff(draft, proposal);
    let proposalToken = null;
    try {
        proposalToken = createProposalToken({
            userId: input.userId || input.user?.id,
            businessScope: input.businessScope,
            fingerprint,
            proposal,
            catalogVersion,
            secret: options.proposalSecret || options.safetySecret
        });
    } catch (error) {
        const failure = {
            ok: false,
            code: error.code || 'TASK_AI_DRAFT_SIGNING_UNAVAILABLE',
            statusCode: error.statusCode || 503,
            reason: 'signing_unavailable',
            provider: 'openai',
            model: result.model || MY_DAY_TASK_AI_MODEL
        };
        safeRecordPreviewTelemetry({
            type: 'preview',
            status: 'error',
            latencyMs: Date.now() - startedAt,
            model: failure.model,
            contractVersion: TASK_AI_DRAFT_CONTRACT_VERSION,
            promptVersion: TASK_AI_DRAFT_PROMPT_VERSION,
            schemaName: TASK_AI_DRAFT_SCHEMA_NAME,
            reasonCode: failure.code,
            userHash: safetyIdentifier,
            businessContext: input.businessScope?.businessContext || input.businessScope?.business_context || '',
            usage: result.usage || {}
        }, options.telemetry);
        return failure;
    }

    safeRecordPreviewTelemetry({
        type: 'preview',
        status: 'success',
        latencyMs: Date.now() - startedAt,
        model: result.model || MY_DAY_TASK_AI_MODEL,
        contractVersion: TASK_AI_DRAFT_CONTRACT_VERSION,
        promptVersion: TASK_AI_DRAFT_PROMPT_VERSION,
        schemaName: TASK_AI_DRAFT_SCHEMA_NAME,
        reasonCode: proposal.action,
        userHash: safetyIdentifier,
        businessContext: input.businessScope?.businessContext || input.businessScope?.business_context || '',
        changedFields: diff.changedFields,
        usage: result.usage || {}
    }, options.telemetry);

    return {
        ok: true,
        contractVersion: TASK_AI_DRAFT_CONTRACT_VERSION,
        promptVersion: TASK_AI_DRAFT_PROMPT_VERSION,
        provider: 'openai',
        model: result.model || MY_DAY_TASK_AI_MODEL,
        proposal,
        diff,
        draftFingerprint: fingerprint,
        proposalHash: proposalHash(proposal),
        catalogVersion,
        impactCatalog: impacts.map(impact => ({
            id: Number(impact.id),
            name: impact.name,
            icon: impact.icon || '',
            color: impact.color || ''
        })),
        proposalToken,
        usage: result.usage || {}
    };
}

function legacyDecompositionResponseFromPreview(preview = {}, fallbackMode = 'ai') {
    const proposal = preview.proposal || {};
    const subtasks = normalizeDraftItems(proposal.subtasks || [], {
        sourceType: 'ai',
        maxItems: MAX_SUBTASKS
    });
    return {
        success: true,
        deprecated: true,
        deprecatedEndpoint: '/api/tasks/ai-draft/preview',
        mode: fallbackMode,
        source: 'ai_draft_preview',
        decision: proposal.action,
        subtasks,
        draftItems: subtasks,
        proposal,
        diff: preview.diff,
        proposalToken: preview.proposalToken,
        meta: {
            aiUsed: true,
            provider: preview.provider,
            model: preview.model,
            contractVersion: preview.contractVersion,
            humanReviewRequired: true
        }
    };
}

module.exports = {
    MAX_SUBTASKS,
    PREVIEW_ACTIONS,
    PREVIEW_MODES,
    TASK_AI_DRAFT_CONTRACT_VERSION,
    TASK_AI_DRAFT_MAX_OUTPUT_TOKENS,
    TASK_AI_DRAFT_PREVIEW_SCHEMA,
    TASK_AI_DRAFT_PROMPT_VERSION,
    TASK_AI_DRAFT_REASONING_EFFORT,
    TASK_AI_DRAFT_SCHEMA_NAME,
    TASK_AI_DRAFT_TIMEOUT_MS,
    TASK_AI_DRAFT_TOKEN_TTL_MS,
    activeImpactCatalogVersion,
    activeImpactPayload,
    buildDraftDiff,
    buildOpenAIResponsesInput,
    buildSystemPrompt,
    buildUserMessage,
    createProposalToken,
    draftFingerprint,
    generateTaskAiDraftPreview,
    legacyDecompositionResponseFromPreview,
    normalizeDraftSnapshot,
    normalizeProposal,
    proposalHash,
    stableStringify,
    verifyProposalToken
};

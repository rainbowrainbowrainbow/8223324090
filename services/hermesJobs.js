'use strict';

const { DEFAULT_TASK_BUSINESS_CONTEXT, activeTaskBusinessContext } = require('./taskBusinessScope');

const HERMES_JOB_TYPES = Object.freeze([
    'menu_photo_job',
    'creative_material_job'
]);

const HERMES_JOB_STATUSES = Object.freeze([
    'queued',
    'claimed',
    'in_progress',
    'needs_input',
    'ready_for_review',
    'revision_requested',
    'approved',
    'rejected',
    'failed',
    'cancelled'
]);

const HERMES_WORKER_STATUS_UPDATES = new Set([
    'claimed',
    'in_progress',
    'needs_input',
    'ready_for_review',
    'failed',
    'cancelled'
]);

const HERMES_RESULT_STATUSES = new Set([
    'in_progress',
    'needs_input',
    'ready_for_review',
    'failed'
]);

const HERMES_JOB_DECISIONS = new Set([
    'approved',
    'rejected',
    'revision_requested'
]);

const HERMES_JOB_ACTIVE_REVIEW_STATUSES = Object.freeze([
    'queued',
    'claimed',
    'in_progress',
    'needs_input',
    'ready_for_review',
    'revision_requested'
]);

const HERMES_JOB_CREATE_ALLOWED_FIELDS = new Set([
    'jobType',
    'job_type',
    'title',
    'businessContext',
    'business_context',
    'source',
    'sourceEntity',
    'sourceEntityType',
    'source_entity_type',
    'sourceEntityId',
    'source_entity_id',
    'payload',
    'dueAt',
    'due_at'
]);

const MENU_PHOTO_PAYLOAD_ALLOWED_FIELDS = new Set([
    'productId',
    'product_id',
    'productCode',
    'product_code',
    'productName',
    'product_name',
    'menuItemName',
    'menu_item_name',
    'prompt',
    'requirements',
    'imageRules',
    'image_rules',
    'size',
    'style',
    'referenceAssetIds',
    'reference_asset_ids'
]);

const CREATIVE_MATERIAL_PAYLOAD_ALLOWED_FIELDS = new Set([
    'brief',
    'title',
    'source',
    'materialType',
    'material_type',
    'materialTypes',
    'material_types',
    'format',
    'formats',
    'formatSize',
    'format_size',
    'platform',
    'platforms',
    'dimensions',
    'copy',
    'tone',
    'audience',
    'eventId',
    'event_id',
    'eventTitle',
    'event_title',
    'brandRules',
    'brand_rules',
    'requirements',
    'deadline',
    'priority',
    'references',
    'referenceUrls',
    'reference_urls',
    'comment',
    'referenceAssetIds',
    'reference_asset_ids'
]);

const HERMES_JOB_STATUS_ALLOWED_FIELDS = new Set([
    'status',
    'message',
    'externalEventId',
    'external_event_id',
    'payload'
]);

const HERMES_JOB_RESULT_ALLOWED_FIELDS = new Set([
    'status',
    'summary',
    'message',
    'externalEventId',
    'external_event_id',
    'result',
    'assets'
]);

const HERMES_JOB_DECISION_ALLOWED_FIELDS = new Set([
    'decision',
    'notes',
    'externalDecisionId',
    'external_decision_id',
    'payload'
]);

const HERMES_JOB_ASSET_ALLOWED_FIELDS = new Set([
    'externalAssetId',
    'external_asset_id',
    'assetType',
    'asset_type',
    'role',
    'url',
    'assetUrl',
    'asset_url',
    'storageKey',
    'storage_key',
    'mimeType',
    'mime_type',
    'checksumSha256',
    'checksum_sha256',
    'metadata'
]);

const HERMES_JOB_ASSET_TYPES = new Set(['source', 'reference', 'result', 'preview', 'final', 'other']);
const MAX_JOB_ASSETS_PER_RESULT = 30;

function hermesJobError(statusCode, code, message, extra = {}) {
    const err = new Error(message);
    err.statusCode = statusCode;
    err.code = code;
    Object.assign(err, extra);
    return err;
}

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value, maxLength = 500, fallback = null) {
    if (value === undefined || value === null) return fallback;
    const text = String(value)
        .replace(/\r\n?/g, '\n')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
        .trim();
    if (!text) return fallback;
    return text.slice(0, maxLength).trim() || fallback;
}

function assertPlainObject(value, code, message) {
    if (!isPlainObject(value)) {
        throw hermesJobError(400, code, message);
    }
}

function assertAllowedFields(value, allowedFields, code) {
    const unsupported = Object.keys(value || {}).filter(key => !allowedFields.has(key));
    if (unsupported.length) {
        throw hermesJobError(400, code, `Unsupported field: ${unsupported[0]}`);
    }
}

function safeJsonObject(value, maxLength = 12000) {
    if (!isPlainObject(value)) return {};
    const copy = JSON.parse(JSON.stringify(value));
    const serialized = JSON.stringify(copy);
    if (serialized.length > maxLength) {
        throw hermesJobError(400, 'HERMES_JOB_PAYLOAD_TOO_LARGE', 'Hermes job payload is too large');
    }
    return copy;
}

function normalizeStringArray(value, maxItems = 20, maxLength = 120) {
    const raw = Array.isArray(value)
        ? value
        : (value === undefined || value === null || value === '' ? [] : String(value).split(','));
    const seen = new Set();
    const result = [];
    for (const item of raw) {
        const text = cleanString(item, maxLength);
        if (!text) continue;
        const key = text.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(text);
        if (result.length >= maxItems) break;
    }
    return result;
}

function normalizeReferenceStrings(value, maxItems = 30, maxLength = 500) {
    const raw = Array.isArray(value)
        ? value
        : (value === undefined || value === null || value === '' ? [] : String(value).split(/[\n,]+/));
    const seen = new Set();
    const result = [];
    for (const item of raw) {
        const text = cleanString(item, maxLength);
        if (!text) continue;
        const key = text.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(text);
        if (result.length >= maxItems) break;
    }
    return result;
}

function normalizeJobType(value) {
    const jobType = cleanString(value, 40);
    if (!HERMES_JOB_TYPES.includes(jobType)) {
        throw hermesJobError(
            400,
            'HERMES_JOB_TYPE_INVALID',
            'jobType must be menu_photo_job or creative_material_job'
        );
    }
    return jobType;
}

function normalizeStatus(value, allowedStatuses, code = 'HERMES_JOB_STATUS_INVALID') {
    const status = cleanString(value, 40);
    if (!status || !allowedStatuses.has(status)) {
        throw hermesJobError(400, code, `status must be one of: ${Array.from(allowedStatuses).join(', ')}`);
    }
    return status;
}

function normalizeDecision(value) {
    const decision = cleanString(value, 40);
    if (!decision || !HERMES_JOB_DECISIONS.has(decision)) {
        throw hermesJobError(400, 'HERMES_JOB_DECISION_INVALID', 'decision must be approved, rejected, or revision_requested');
    }
    return decision;
}

function normalizeDueAt(value) {
    if (value === undefined || value === null || value === '') return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        throw hermesJobError(400, 'HERMES_JOB_DUE_AT_INVALID', 'dueAt must be a valid date-time');
    }
    return parsed.toISOString();
}

function normalizeSourceEntity(body = {}) {
    const source = isPlainObject(body.source) ? body.source : {};
    const sourceEntity = isPlainObject(body.sourceEntity) ? body.sourceEntity : {};
    return {
        type: cleanString(
            body.sourceEntityType
            || body.source_entity_type
            || sourceEntity.type
            || source.entityType
            || source.entity_type,
            80
        ),
        id: cleanString(
            body.sourceEntityId
            || body.source_entity_id
            || sourceEntity.id
            || source.entityId
            || source.entity_id,
            120
        )
    };
}

function normalizeMenuPhotoPayload(payload = {}) {
    assertPlainObject(payload, 'HERMES_JOB_PAYLOAD_INVALID', 'payload must be a JSON object');
    assertAllowedFields(payload, MENU_PHOTO_PAYLOAD_ALLOWED_FIELDS, 'HERMES_JOB_PAYLOAD_UNSUPPORTED_FIELD');

    const productId = cleanString(payload.productId || payload.product_id, 120);
    const productCode = cleanString(payload.productCode || payload.product_code, 120);
    const productName = cleanString(payload.productName || payload.product_name || payload.menuItemName || payload.menu_item_name, 220);

    if (!productId && !productCode && !productName) {
        throw hermesJobError(
            400,
            'HERMES_MENU_PHOTO_TARGET_REQUIRED',
            'menu_photo_job payload requires productId, productCode, or productName'
        );
    }

    const imageRules = safeJsonObject(payload.imageRules || payload.image_rules || {}, 4000);
    const sourcePayload = {
        product: {
            id: productId,
            code: productCode,
            name: productName
        },
        prompt: cleanString(payload.prompt, 5000),
        requirements: cleanString(payload.requirements, 4000),
        imageRules,
        size: cleanString(payload.size, 40),
        style: cleanString(payload.style, 80),
        referenceAssetIds: normalizeStringArray(payload.referenceAssetIds || payload.reference_asset_ids, 30, 160)
    };

    return {
        sourcePayload,
        hermesPayload: {
            target: 'menu_photo',
            product: sourcePayload.product,
            prompt: sourcePayload.prompt,
            requirements: sourcePayload.requirements,
            image: {
                size: sourcePayload.size,
                style: sourcePayload.style,
                rules: imageRules
            },
            referenceAssetIds: sourcePayload.referenceAssetIds
        },
        fallbackTitle: `Menu photo: ${productName || productCode || productId}`
    };
}

function normalizeCreativeMaterialPayload(payload = {}) {
    assertPlainObject(payload, 'HERMES_JOB_PAYLOAD_INVALID', 'payload must be a JSON object');
    assertAllowedFields(payload, CREATIVE_MATERIAL_PAYLOAD_ALLOWED_FIELDS, 'HERMES_JOB_PAYLOAD_UNSUPPORTED_FIELD');

    const title = cleanString(payload.title, 240);
    const source = cleanString(payload.source, 500);
    const requirements = cleanString(payload.requirements, 4000);
    const comment = cleanString(payload.comment, 2000);
    const explicitBrief = cleanString(payload.brief, 5000);
    const brief = explicitBrief || [title, source, requirements, comment].filter(Boolean).join('\n\n') || null;
    const materialTypes = normalizeStringArray(
        payload.materialTypes
        || payload.material_types
        || payload.materialType
        || payload.material_type,
        20,
        80
    );
    const formats = normalizeStringArray(
        payload.formats
        || payload.format
        || payload.formatSize
        || payload.format_size,
        20,
        120
    );

    if (!brief && !materialTypes.length && !formats.length && !title) {
        throw hermesJobError(
            400,
            'HERMES_CREATIVE_MATERIAL_BRIEF_REQUIRED',
            'creative_material_job payload requires brief, title, materialType, or format'
        );
    }

    const event = {
        id: cleanString(payload.eventId || payload.event_id, 120),
        title: cleanString(payload.eventTitle || payload.event_title, 220)
    };
    const sourcePayload = {
        title,
        source,
        brief,
        materialTypes,
        formats,
        formatSize: formats[0] || null,
        platforms: normalizeStringArray(payload.platforms || payload.platform, 20, 80),
        dimensions: normalizeStringArray(payload.dimensions, 20, 80),
        copy: cleanString(payload.copy, 5000),
        tone: cleanString(payload.tone, 160),
        audience: cleanString(payload.audience, 240),
        event,
        brandRules: cleanString(payload.brandRules || payload.brand_rules, 4000),
        requirements,
        deadline: cleanString(payload.deadline, 120),
        priority: cleanString(payload.priority, 40),
        references: normalizeReferenceStrings(payload.references || payload.referenceUrls || payload.reference_urls, 30, 500),
        comment,
        referenceAssetIds: normalizeStringArray(payload.referenceAssetIds || payload.reference_asset_ids, 30, 160)
    };

    return {
        sourcePayload,
        hermesPayload: {
            target: 'creative_material',
            title: sourcePayload.title,
            source: sourcePayload.source,
            brief: sourcePayload.brief,
            materialTypes: sourcePayload.materialTypes,
            formats: sourcePayload.formats,
            formatSize: sourcePayload.formatSize,
            platforms: sourcePayload.platforms,
            dimensions: sourcePayload.dimensions,
            copy: sourcePayload.copy,
            tone: sourcePayload.tone,
            audience: sourcePayload.audience,
            event,
            brandRules: sourcePayload.brandRules,
            requirements: sourcePayload.requirements,
            deadline: sourcePayload.deadline,
            priority: sourcePayload.priority,
            references: sourcePayload.references,
            comment: sourcePayload.comment,
            referenceAssetIds: sourcePayload.referenceAssetIds
        },
        fallbackTitle: `Creative material: ${title || materialTypes[0] || formats[0] || brief.slice(0, 80) || 'job'}`
    };
}

function normalizeCreateHermesJobInput(body = {}, context = {}) {
    assertPlainObject(body, 'HERMES_JOB_PAYLOAD_INVALID', 'Request body must be a JSON object');
    assertAllowedFields(body, HERMES_JOB_CREATE_ALLOWED_FIELDS, 'HERMES_JOB_UNSUPPORTED_FIELD');

    const jobType = normalizeJobType(body.jobType || body.job_type);
    const businessContext = activeTaskBusinessContext(
        body.businessContext
        || body.business_context
        || context.businessContext
        || DEFAULT_TASK_BUSINESS_CONTEXT
    );
    const source = normalizeSourceEntity(body);
    const payloadResult = jobType === 'menu_photo_job'
        ? normalizeMenuPhotoPayload(body.payload || {})
        : normalizeCreativeMaterialPayload(body.payload || {});
    const title = cleanString(body.title, 240) || payloadResult.fallbackTitle;

    return {
        jobType,
        businessContext,
        title,
        sourceEntityType: source.type,
        sourceEntityId: source.id,
        sourcePayload: payloadResult.sourcePayload,
        hermesPayload: {
            version: 1,
            jobType,
            businessContext,
            ...payloadResult.hermesPayload
        },
        dueAt: normalizeDueAt(body.dueAt || body.due_at)
    };
}

function actorUserId(actor = {}) {
    const id = Number(actor.id || actor.user_id || actor.userId || 0);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function actorSnapshot(actor = {}, fallback = 'hermes') {
    return cleanString(actor.name || actor.username || actor.displayName || fallback, 160) || fallback;
}

function parseJobId(value) {
    const text = String(value || '').trim();
    if (!/^\d+$/.test(text)) {
        throw hermesJobError(400, 'HERMES_JOB_ID_INVALID', 'Hermes job id must be a positive integer');
    }
    const id = Number.parseInt(text, 10);
    if (!Number.isSafeInteger(id) || id <= 0) {
        throw hermesJobError(400, 'HERMES_JOB_ID_INVALID', 'Hermes job id must be a positive integer');
    }
    return id;
}

function isoOrNull(value) {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function safeJsonParse(value, fallback = {}) {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        } catch {
            return fallback;
        }
    }
    if (typeof value === 'object') return value;
    return fallback;
}

function normalizeJobRow(row = {}) {
    if (!row || !row.id) return null;
    return {
        id: String(row.id),
        numericId: Number(row.id),
        businessContext: row.business_context || DEFAULT_TASK_BUSINESS_CONTEXT,
        jobType: row.job_type,
        status: row.status,
        title: row.title,
        sourceEntity: {
            type: row.source_entity_type || null,
            id: row.source_entity_id || null
        },
        sourcePayload: safeJsonParse(row.source_payload),
        hermesPayload: safeJsonParse(row.hermes_payload),
        resultPayload: safeJsonParse(row.result_payload),
        errorMessage: row.error_message || null,
        claimToken: row.claim_token || null,
        claimedBy: row.claimed_by || null,
        claimedAt: isoOrNull(row.claimed_at),
        dueAt: isoOrNull(row.due_at),
        createdBy: row.created_by_user_id ? {
            id: String(row.created_by_user_id),
            name: row.created_by_snapshot || null
        } : null,
        updatedBy: row.updated_by_user_id ? {
            id: String(row.updated_by_user_id),
            name: row.updated_by_snapshot || null
        } : null,
        completedAt: isoOrNull(row.completed_at),
        createdAt: isoOrNull(row.created_at),
        updatedAt: isoOrNull(row.updated_at)
    };
}

function normalizeAssetRow(row = {}) {
    return {
        id: String(row.id),
        jobId: String(row.job_id),
        assetType: row.asset_type,
        role: row.role || null,
        externalAssetId: row.external_asset_id || null,
        url: row.url || null,
        storageKey: row.storage_key || null,
        mimeType: row.mime_type || null,
        checksumSha256: row.checksum_sha256 || null,
        metadata: safeJsonParse(row.metadata),
        createdAt: isoOrNull(row.created_at),
        updatedAt: isoOrNull(row.updated_at)
    };
}

function normalizeEventRow(row = {}) {
    return {
        id: String(row.id),
        jobId: String(row.job_id),
        eventType: row.event_type,
        source: row.source,
        statusFrom: row.status_from || null,
        statusTo: row.status_to || null,
        actor: row.actor_user_id ? {
            id: String(row.actor_user_id),
            name: row.actor_snapshot || null
        } : (row.actor_snapshot ? { id: null, name: row.actor_snapshot } : null),
        externalEventId: row.external_event_id || null,
        summary: row.summary || null,
        payload: safeJsonParse(row.payload),
        createdAt: isoOrNull(row.created_at)
    };
}

function normalizeDecisionRow(row = {}) {
    return {
        id: String(row.id),
        jobId: String(row.job_id),
        decision: row.decision,
        decidedBy: row.decided_by_user_id ? {
            id: String(row.decided_by_user_id),
            name: row.decided_by_snapshot || null
        } : (row.decided_by_snapshot ? { id: null, name: row.decided_by_snapshot } : null),
        notes: row.notes || null,
        externalDecisionId: row.external_decision_id || null,
        payload: safeJsonParse(row.decision_payload),
        createdAt: isoOrNull(row.created_at)
    };
}

function toHermesWorkerPayload(job = {}) {
    return {
        jobId: job.id,
        jobType: job.jobType,
        status: job.status,
        businessContext: job.businessContext,
        title: job.title,
        payload: {
            ...(job.hermesPayload || {}),
            jobId: job.id,
            jobType: job.jobType,
            businessContext: job.businessContext
        }
    };
}

function toHermesJobApi(row, extras = {}) {
    const job = normalizeJobRow(row);
    if (!job) return null;
    const assets = (extras.assets || []).map(normalizeAssetRow);
    const history = (extras.history || []).map(normalizeEventRow);
    const decisions = (extras.decisions || []).map(normalizeDecisionRow);
    return {
        ...job,
        hermes: toHermesWorkerPayload(job),
        assets,
        history,
        decision: decisions[0] || null,
        decisions
    };
}

async function insertHermesJobEvent(queryable, job, event = {}, actor = {}) {
    const actorId = actorUserId(actor);
    const actorName = actorSnapshot(actor, event.source === 'hermes' ? 'hermes' : 'crm');
    const result = await queryable.query(
        `INSERT INTO hermes_job_events (
             job_id,
             event_type,
             source,
             status_from,
             status_to,
             actor_user_id,
             actor_snapshot,
             external_event_id,
             summary,
             payload
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
         ON CONFLICT (job_id, external_event_id) WHERE external_event_id IS NOT NULL
         DO UPDATE SET
             summary = EXCLUDED.summary,
             payload = EXCLUDED.payload
         RETURNING *`,
        [
            Number(job.id),
            event.eventType,
            event.source || 'crm',
            event.statusFrom || null,
            event.statusTo || null,
            actorId,
            actorName,
            cleanString(event.externalEventId, 160),
            cleanString(event.summary, 1000),
            JSON.stringify(safeJsonObject(event.payload || {}, 8000))
        ]
    );
    return result.rows[0] || null;
}

async function createHermesJob(queryable, body = {}, context = {}) {
    const actor = context.actor || {};
    const input = normalizeCreateHermesJobInput(body, context);
    const actorId = actorUserId(actor);
    const actorName = actorSnapshot(actor, 'crm');
    const result = await queryable.query(
        `INSERT INTO hermes_jobs (
             business_context,
             job_type,
             status,
             title,
             source_entity_type,
             source_entity_id,
             source_payload,
             hermes_payload,
             due_at,
             created_by_user_id,
             created_by_snapshot,
             updated_by_user_id,
             updated_by_snapshot
         )
         VALUES ($1,$2,'queued',$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$9,$10)
         RETURNING *`,
        [
            input.businessContext,
            input.jobType,
            input.title,
            input.sourceEntityType,
            input.sourceEntityId,
            JSON.stringify(input.sourcePayload),
            JSON.stringify(input.hermesPayload),
            input.dueAt,
            actorId,
            actorName
        ]
    );
    const job = result.rows[0];
    const event = await insertHermesJobEvent(queryable, job, {
        eventType: 'job_created',
        source: 'crm',
        statusTo: 'queued',
        summary: `Hermes ${input.jobType} queued`,
        payload: {
            jobType: input.jobType,
            sourceEntity: {
                type: input.sourceEntityType,
                id: input.sourceEntityId
            }
        }
    }, actor);
    return {
        job,
        event
    };
}

async function findHermesJob(queryable, jobId, businessContext, options = {}) {
    const id = parseJobId(jobId);
    const result = await queryable.query(
        `SELECT *
         FROM hermes_jobs
         WHERE id = $1
           AND COALESCE(business_context, '${DEFAULT_TASK_BUSINESS_CONTEXT}') = $2
         LIMIT 1
         ${options.forUpdate ? 'FOR UPDATE' : ''}`,
        [id, activeTaskBusinessContext(businessContext)]
    );
    return result.rows[0] || null;
}

async function requireHermesJob(queryable, jobId, businessContext, options = {}) {
    const job = await findHermesJob(queryable, jobId, businessContext, options);
    if (!job) {
        throw hermesJobError(404, 'HERMES_JOB_NOT_FOUND', 'Hermes job not found');
    }
    return job;
}

async function loadHermesJobRelations(queryable, jobId) {
    const id = parseJobId(jobId);
    const [assets, history, decisions] = await Promise.all([
        queryable.query(
            `SELECT *
             FROM hermes_job_assets
             WHERE job_id = $1
             ORDER BY created_at ASC, id ASC`,
            [id]
        ),
        queryable.query(
            `SELECT *
             FROM hermes_job_events
             WHERE job_id = $1
             ORDER BY created_at ASC, id ASC`,
            [id]
        ),
        queryable.query(
            `SELECT *
             FROM hermes_job_decisions
             WHERE job_id = $1
             ORDER BY created_at DESC, id DESC`,
            [id]
        )
    ]);

    return {
        assets: assets.rows || [],
        history: history.rows || [],
        decisions: decisions.rows || []
    };
}

async function getHermesJobDetail(queryable, jobId, businessContext) {
    const job = await requireHermesJob(queryable, jobId, businessContext);
    const relations = await loadHermesJobRelations(queryable, job.id);
    return toHermesJobApi(job, relations);
}

async function listQueuedHermesJobs(queryable, options = {}) {
    const params = [activeTaskBusinessContext(options.businessContext || DEFAULT_TASK_BUSINESS_CONTEXT)];
    let jobTypeFilter = '';
    if (options.jobType) {
        const jobType = normalizeJobType(options.jobType);
        params.push(jobType);
        jobTypeFilter = `AND job_type = $${params.length}`;
    }
    const limit = Math.max(1, Math.min(Number.parseInt(options.limit, 10) || 20, 50));
    params.push(limit);
    const result = await queryable.query(
        `SELECT *
         FROM hermes_jobs
         WHERE COALESCE(business_context, '${DEFAULT_TASK_BUSINESS_CONTEXT}') = $1
           AND status = 'queued'
           ${jobTypeFilter}
         ORDER BY created_at ASC, id ASC
         LIMIT $${params.length}`,
        params
    );
    return (result.rows || []).map(row => toHermesJobApi(row));
}

async function listHermesJobs(queryable, options = {}) {
    const params = [activeTaskBusinessContext(options.businessContext || DEFAULT_TASK_BUSINESS_CONTEXT)];
    const conditions = [
        `COALESCE(business_context, '${DEFAULT_TASK_BUSINESS_CONTEXT}') = $1`
    ];

    if (options.jobType) {
        params.push(normalizeJobType(options.jobType));
        conditions.push(`job_type = $${params.length}`);
    }

    const status = cleanString(options.status, 40);
    if (status && status !== 'all') {
        if (!HERMES_JOB_STATUSES.includes(status)) {
            throw hermesJobError(400, 'HERMES_JOB_STATUS_INVALID', `status must be one of: ${HERMES_JOB_STATUSES.join(', ')}`);
        }
        params.push(status);
        conditions.push(`status = $${params.length}`);
    }

    const limit = Math.max(1, Math.min(Number.parseInt(options.limit, 10) || 50, 100));
    params.push(limit);
    const result = await queryable.query(
        `SELECT *
         FROM hermes_jobs
         WHERE ${conditions.join(' AND ')}
         ORDER BY updated_at DESC, id DESC
         LIMIT $${params.length}`,
        params
    );

    if (!options.includeRelations) {
        return (result.rows || []).map(row => toHermesJobApi(row));
    }

    return Promise.all((result.rows || []).map(async row => {
        const relations = await loadHermesJobRelations(queryable, row.id);
        return toHermesJobApi(row, relations);
    }));
}

async function findActiveHermesJobBySource(queryable, options = {}) {
    const businessContext = activeTaskBusinessContext(options.businessContext || DEFAULT_TASK_BUSINESS_CONTEXT);
    const jobType = normalizeJobType(options.jobType || options.job_type);
    const sourceEntityType = cleanString(options.sourceEntityType || options.source_entity_type, 80);
    const sourceEntityId = cleanString(options.sourceEntityId || options.source_entity_id, 120);
    const statuses = Array.isArray(options.statuses) && options.statuses.length
        ? options.statuses.map(status => cleanString(status, 40)).filter(status => HERMES_JOB_STATUSES.includes(status))
        : HERMES_JOB_ACTIVE_REVIEW_STATUSES;

    if (!sourceEntityType || !sourceEntityId || !statuses.length) return null;

    const result = await queryable.query(
        `SELECT *
         FROM hermes_jobs
         WHERE COALESCE(business_context, '${DEFAULT_TASK_BUSINESS_CONTEXT}') = $1
           AND job_type = $2
           AND source_entity_type = $3
           AND source_entity_id = $4
           AND status = ANY($5::text[])
         ORDER BY updated_at DESC, id DESC
         LIMIT 1`,
        [businessContext, jobType, sourceEntityType, sourceEntityId, statuses]
    );
    return result.rows[0] || null;
}

async function claimHermesJob(queryable, jobId, context = {}) {
    const businessContext = activeTaskBusinessContext(context.businessContext || DEFAULT_TASK_BUSINESS_CONTEXT);
    const actor = context.actor || {};
    const actorId = actorUserId(actor);
    const actorName = actorSnapshot(actor, 'hermes');
    const workerId = cleanString(context.workerId, 160) || actorName;
    const claimToken = cleanString(context.claimToken, 160);
    const id = parseJobId(jobId);
    const result = await queryable.query(
        `UPDATE hermes_jobs
         SET status = 'claimed',
             claimed_by = $3,
             claim_token = COALESCE($4, claim_token),
             claimed_at = COALESCE(claimed_at, NOW()),
             updated_by_user_id = $5,
             updated_by_snapshot = $6,
             updated_at = NOW()
         WHERE id = $1
           AND COALESCE(business_context, '${DEFAULT_TASK_BUSINESS_CONTEXT}') = $2
           AND status = 'queued'
         RETURNING *`,
        [id, businessContext, workerId, claimToken, actorId, actorName]
    );

    if (!result.rows.length) {
        const existing = await requireHermesJob(queryable, id, businessContext);
        if (existing.status !== 'queued') {
            throw hermesJobError(409, 'HERMES_JOB_NOT_CLAIMABLE', 'Hermes job is not queued', {
                existingStatus: existing.status
            });
        }
        throw hermesJobError(409, 'HERMES_JOB_NOT_CLAIMABLE', 'Hermes job could not be claimed');
    }

    const job = result.rows[0];
    const event = await insertHermesJobEvent(queryable, job, {
        eventType: 'job_claimed',
        source: 'hermes',
        statusFrom: 'queued',
        statusTo: 'claimed',
        summary: `Hermes job claimed by ${workerId}`,
        payload: {
            workerId
        }
    }, actor);
    return { job, event };
}

function normalizeStatusBody(body = {}) {
    assertPlainObject(body, 'HERMES_JOB_STATUS_PAYLOAD_INVALID', 'Request body must be a JSON object');
    assertAllowedFields(body, HERMES_JOB_STATUS_ALLOWED_FIELDS, 'HERMES_JOB_UNSUPPORTED_FIELD');
    return {
        status: normalizeStatus(body.status, HERMES_WORKER_STATUS_UPDATES),
        message: cleanString(body.message, 1000),
        externalEventId: cleanString(body.externalEventId || body.external_event_id, 160),
        payload: safeJsonObject(body.payload || {}, 8000)
    };
}

async function updateHermesJobStatus(queryable, jobId, body = {}, context = {}) {
    const businessContext = activeTaskBusinessContext(context.businessContext || DEFAULT_TASK_BUSINESS_CONTEXT);
    const actor = context.actor || {};
    const payload = normalizeStatusBody(body);
    const current = await requireHermesJob(queryable, jobId, businessContext, { forUpdate: true });
    const actorId = actorUserId(actor);
    const actorName = actorSnapshot(actor, 'hermes');
    const result = await queryable.query(
        `UPDATE hermes_jobs
         SET status = $3::varchar,
             error_message = CASE WHEN $3::text = 'failed' THEN COALESCE($6, error_message) ELSE error_message END,
             completed_at = CASE WHEN $3::text IN ('failed','cancelled') THEN COALESCE(completed_at, NOW()) ELSE completed_at END,
             updated_by_user_id = $4,
             updated_by_snapshot = $5,
             updated_at = NOW()
         WHERE id = $1
           AND COALESCE(business_context, '${DEFAULT_TASK_BUSINESS_CONTEXT}') = $2
         RETURNING *`,
        [Number(current.id), businessContext, payload.status, actorId, actorName, payload.message]
    );
    const job = result.rows[0];
    const event = await insertHermesJobEvent(queryable, job, {
        eventType: 'status_updated',
        source: 'hermes',
        statusFrom: current.status,
        statusTo: payload.status,
        externalEventId: payload.externalEventId,
        summary: payload.message || `Hermes job status changed to ${payload.status}`,
        payload: payload.payload
    }, actor);
    return { job, event };
}

function normalizeAssetInput(asset = {}, index = 0) {
    assertPlainObject(asset, 'HERMES_JOB_ASSET_INVALID', 'asset must be a JSON object');
    assertAllowedFields(asset, HERMES_JOB_ASSET_ALLOWED_FIELDS, 'HERMES_JOB_ASSET_UNSUPPORTED_FIELD');
    const assetType = cleanString(asset.assetType || asset.asset_type || 'result', 40) || 'result';
    if (!HERMES_JOB_ASSET_TYPES.has(assetType)) {
        throw hermesJobError(400, 'HERMES_JOB_ASSET_TYPE_INVALID', 'assetType is invalid');
    }
    const url = cleanString(asset.url || asset.assetUrl || asset.asset_url, 2000);
    const storageKey = cleanString(asset.storageKey || asset.storage_key, 500);
    if (!url && !storageKey) {
        throw hermesJobError(400, 'HERMES_JOB_ASSET_LOCATION_REQUIRED', `assets[${index}] requires url or storageKey`);
    }
    const checksum = cleanString(asset.checksumSha256 || asset.checksum_sha256, 64);
    if (checksum && !/^[a-f0-9]{64}$/.test(checksum)) {
        throw hermesJobError(400, 'HERMES_JOB_ASSET_CHECKSUM_INVALID', `assets[${index}].checksumSha256 is invalid`);
    }
    return {
        assetType,
        role: cleanString(asset.role, 80),
        externalAssetId: cleanString(asset.externalAssetId || asset.external_asset_id, 160),
        url,
        storageKey,
        mimeType: cleanString(asset.mimeType || asset.mime_type, 120),
        checksumSha256: checksum,
        metadata: safeJsonObject(asset.metadata || {}, 5000)
    };
}

function normalizeResultBody(body = {}) {
    assertPlainObject(body, 'HERMES_JOB_RESULT_PAYLOAD_INVALID', 'Request body must be a JSON object');
    assertAllowedFields(body, HERMES_JOB_RESULT_ALLOWED_FIELDS, 'HERMES_JOB_UNSUPPORTED_FIELD');
    const assets = Array.isArray(body.assets) ? body.assets : [];
    if (assets.length > MAX_JOB_ASSETS_PER_RESULT) {
        throw hermesJobError(400, 'HERMES_JOB_ASSET_LIMIT_EXCEEDED', `assets limit is ${MAX_JOB_ASSETS_PER_RESULT}`);
    }
    const status = body.status === undefined || body.status === null || body.status === ''
        ? 'ready_for_review'
        : normalizeStatus(body.status, HERMES_RESULT_STATUSES, 'HERMES_JOB_RESULT_STATUS_INVALID');
    return {
        status,
        summary: cleanString(body.summary || body.message, 1000),
        externalEventId: cleanString(body.externalEventId || body.external_event_id, 160),
        result: normalizeResultPayload(body.result || {}),
        assets: assets.map(normalizeAssetInput)
    };
}

function normalizeResultPayload(value = {}) {
    if (!isPlainObject(value)) return {};
    const {
        imageBase64: _imageBase64,
        image_base64: _imageBase64Snake,
        ...persistable
    } = value;
    return safeJsonObject(persistable, 12000);
}

async function insertHermesJobAsset(queryable, job, asset = {}) {
    const result = await queryable.query(
        `INSERT INTO hermes_job_assets (
             job_id,
             asset_type,
             role,
             external_asset_id,
             url,
             storage_key,
             mime_type,
             checksum_sha256,
             metadata
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
         ON CONFLICT (job_id, external_asset_id) WHERE external_asset_id IS NOT NULL
         DO UPDATE SET
             asset_type = EXCLUDED.asset_type,
             role = EXCLUDED.role,
             url = EXCLUDED.url,
             storage_key = EXCLUDED.storage_key,
             mime_type = EXCLUDED.mime_type,
             checksum_sha256 = EXCLUDED.checksum_sha256,
             metadata = EXCLUDED.metadata,
             updated_at = NOW()
         RETURNING *`,
        [
            Number(job.id),
            asset.assetType,
            asset.role,
            asset.externalAssetId,
            asset.url,
            asset.storageKey,
            asset.mimeType,
            asset.checksumSha256,
            JSON.stringify(asset.metadata || {})
        ]
    );
    return result.rows[0] || null;
}

async function recordHermesJobResult(queryable, jobId, body = {}, context = {}) {
    const businessContext = activeTaskBusinessContext(context.businessContext || DEFAULT_TASK_BUSINESS_CONTEXT);
    const actor = context.actor || {};
    const payload = normalizeResultBody(body);
    const current = await requireHermesJob(queryable, jobId, businessContext, { forUpdate: true });
    const actorId = actorUserId(actor);
    const actorName = actorSnapshot(actor, 'hermes');
    const result = await queryable.query(
        `UPDATE hermes_jobs
         SET status = $3::varchar,
             result_payload = $4::jsonb,
             error_message = CASE WHEN $3::text = 'failed' THEN COALESCE($7, error_message) ELSE error_message END,
             completed_at = CASE WHEN $3::text IN ('ready_for_review','failed') THEN COALESCE(completed_at, NOW()) ELSE completed_at END,
             updated_by_user_id = $5,
             updated_by_snapshot = $6,
             updated_at = NOW()
         WHERE id = $1
           AND COALESCE(business_context, '${DEFAULT_TASK_BUSINESS_CONTEXT}') = $2
         RETURNING *`,
        [
            Number(current.id),
            businessContext,
            payload.status,
            JSON.stringify(payload.result),
            actorId,
            actorName,
            payload.summary
        ]
    );
    const job = result.rows[0];
    const assets = [];
    for (const asset of payload.assets) {
        const saved = await insertHermesJobAsset(queryable, job, asset);
        if (saved) assets.push(saved);
    }
    const event = await insertHermesJobEvent(queryable, job, {
        eventType: 'result_posted',
        source: 'hermes',
        statusFrom: current.status,
        statusTo: payload.status,
        externalEventId: payload.externalEventId,
        summary: payload.summary || `Hermes job result posted with ${assets.length} asset(s)`,
        payload: {
            result: payload.result,
            assetCount: assets.length
        }
    }, actor);
    return { job, assets, event };
}

function normalizeDecisionBody(body = {}) {
    assertPlainObject(body, 'HERMES_JOB_DECISION_PAYLOAD_INVALID', 'Request body must be a JSON object');
    assertAllowedFields(body, HERMES_JOB_DECISION_ALLOWED_FIELDS, 'HERMES_JOB_UNSUPPORTED_FIELD');
    return {
        decision: normalizeDecision(body.decision),
        notes: cleanString(body.notes, 4000),
        externalDecisionId: cleanString(body.externalDecisionId || body.external_decision_id, 160),
        payload: safeJsonObject(body.payload || {}, 8000)
    };
}

async function insertHermesJobDecision(queryable, job, payload = {}, actor = {}) {
    const actorId = actorUserId(actor);
    const actorName = actorSnapshot(actor, 'crm');
    const result = await queryable.query(
        `INSERT INTO hermes_job_decisions (
             job_id,
             decision,
             decided_by_user_id,
             decided_by_snapshot,
             notes,
             external_decision_id,
             decision_payload
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
         ON CONFLICT (job_id, external_decision_id) WHERE external_decision_id IS NOT NULL
         DO UPDATE SET
             notes = EXCLUDED.notes,
             decision_payload = EXCLUDED.decision_payload
         RETURNING *`,
        [
            Number(job.id),
            payload.decision,
            actorId,
            actorName,
            payload.notes,
            payload.externalDecisionId,
            JSON.stringify(payload.payload || {})
        ]
    );
    return result.rows[0] || null;
}

async function recordHermesJobDecision(queryable, jobId, body = {}, context = {}) {
    const businessContext = activeTaskBusinessContext(context.businessContext || DEFAULT_TASK_BUSINESS_CONTEXT);
    const actor = context.actor || {};
    const payload = normalizeDecisionBody(body);
    const current = await requireHermesJob(queryable, jobId, businessContext, { forUpdate: true });
    const actorId = actorUserId(actor);
    const actorName = actorSnapshot(actor, 'crm');
    const updated = await queryable.query(
        `UPDATE hermes_jobs
         SET status = $3,
             completed_at = CASE WHEN $3 IN ('approved','rejected') THEN COALESCE(completed_at, NOW()) ELSE completed_at END,
             updated_by_user_id = $4,
             updated_by_snapshot = $5,
             updated_at = NOW()
         WHERE id = $1
           AND COALESCE(business_context, '${DEFAULT_TASK_BUSINESS_CONTEXT}') = $2
         RETURNING *`,
        [Number(current.id), businessContext, payload.decision, actorId, actorName]
    );
    const job = updated.rows[0];
    const decision = await insertHermesJobDecision(queryable, job, payload, actor);
    const event = await insertHermesJobEvent(queryable, job, {
        eventType: 'decision_recorded',
        source: 'crm',
        statusFrom: current.status,
        statusTo: payload.decision,
        externalEventId: payload.externalDecisionId,
        summary: payload.notes || `Hermes job decision recorded: ${payload.decision}`,
        payload: {
            decision: payload.decision,
            ...payload.payload
        }
    }, actor);
    return { job, decision, event };
}

module.exports = {
    HERMES_JOB_ACTIVE_REVIEW_STATUSES,
    HERMES_JOB_DECISIONS: Array.from(HERMES_JOB_DECISIONS),
    HERMES_JOB_STATUSES,
    HERMES_JOB_TYPES,
    claimHermesJob,
    createHermesJob,
    findActiveHermesJobBySource,
    getHermesJobDetail,
    hermesJobError,
    listHermesJobs,
    listQueuedHermesJobs,
    normalizeCreateHermesJobInput,
    recordHermesJobDecision,
    recordHermesJobResult,
    toHermesJobApi,
    updateHermesJobStatus
};

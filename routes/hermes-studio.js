'use strict';

const express = require('express');
const { pool } = require('../db');
const {
    authenticateToken,
    requireRole
} = require('../middleware/auth');
const {
    DEFAULT_TASK_BUSINESS_CONTEXT,
    activeTaskBusinessContext
} = require('../services/taskBusinessScope');
const {
    createHermesJob,
    getHermesJobDetail,
    hermesJobError,
    listHermesJobs,
    recordHermesJobDecision
} = require('../services/hermesJobs');
const { createLogger } = require('../utils/logger');

const log = createLogger('HermesStudio');

const CREATIVE_JOB_TYPE = 'creative_material_job';
const STUDIO_ACCESS_ROLES = [
    'creator',
    'director',
    'vice_director',
    'senior_manager',
    'manager',
    'art_director',
    'marketer',
    'admin'
];
const STUDIO_DECISION_ROLES = [
    'creator',
    'director',
    'vice_director',
    'senior_manager',
    'art_director',
    'marketer',
    'admin'
];

const STUDIO_CREATE_ALLOWED_FIELDS = new Set([
    'businessContext',
    'business_context',
    'materialType',
    'material_type',
    'title',
    'source',
    'formatSize',
    'format_size',
    'format',
    'size',
    'requirements',
    'deadline',
    'priority',
    'references',
    'comment',
    'sourceEntity',
    'sourceEntityType',
    'source_entity_type',
    'sourceEntityId',
    'source_entity_id',
    'dueAt',
    'due_at'
]);

const STUDIO_DECISION_ALLOWED_FIELDS = new Set([
    'decision',
    'notes',
    'comment',
    'action',
    'businessContext',
    'business_context'
]);

function cleanStudioString(value, maxLength = 1000, fallback = null) {
    if (value === undefined || value === null) return fallback;
    const text = String(value)
        .replace(/\r\n?/g, '\n')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
        .trim();
    if (!text) return fallback;
    return text.slice(0, maxLength).trim() || fallback;
}

function assertPlainObject(value, code, message) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw hermesJobError(400, code, message);
    }
}

function assertAllowedFields(body, allowedFields, code) {
    const unsupported = Object.keys(body || {}).filter(key => !allowedFields.has(key));
    if (unsupported.length) {
        throw hermesJobError(400, code, `Unsupported field: ${unsupported[0]}`);
    }
}

function normalizeReferenceList(value) {
    const raw = Array.isArray(value)
        ? value
        : (value === undefined || value === null || value === '' ? [] : String(value).split(/[\n,]+/));
    const seen = new Set();
    const result = [];
    for (const item of raw) {
        const text = cleanStudioString(item, 500);
        if (!text) continue;
        const key = text.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(text);
        if (result.length >= 30) break;
    }
    return result;
}

function userBusinessContexts(user = {}) {
    const raw = user.businessContexts
        || user.business_contexts
        || user.businessContext
        || user.business_context
        || user.defaultBusinessContext
        || user.default_business_context
        || DEFAULT_TASK_BUSINESS_CONTEXT;
    const values = Array.isArray(raw)
        ? raw
        : String(raw || DEFAULT_TASK_BUSINESS_CONTEXT).split(',');
    const fallback = activeTaskBusinessContext(
        user.defaultBusinessContext
        || user.default_business_context
        || DEFAULT_TASK_BUSINESS_CONTEXT
    );
    const contexts = values
        .map(value => activeTaskBusinessContext(value || fallback))
        .filter(Boolean);
    if (!contexts.includes(fallback)) contexts.push(fallback);
    return [...new Set(contexts)];
}

function resolveStudioBusinessContext(req) {
    const requested = req.body?.businessContext
        || req.body?.business_context
        || req.query?.businessContext
        || req.query?.business_context
        || req.user?.defaultBusinessContext
        || req.user?.default_business_context
        || DEFAULT_TASK_BUSINESS_CONTEXT;

    if (String(requested || '').includes(',')) {
        throw hermesJobError(400, 'HERMES_STUDIO_BUSINESS_CONTEXT_INVALID', 'Hermes Studio requires one active businessContext');
    }

    const businessContext = activeTaskBusinessContext(requested);
    const allowed = userBusinessContexts(req.user || {});
    if (allowed.length && !allowed.includes(businessContext)) {
        throw hermesJobError(403, 'HERMES_STUDIO_BUSINESS_CONTEXT_FORBIDDEN', 'Business context is not available for this user');
    }
    return businessContext;
}

function assertCreativeJob(job) {
    if (!job || job.jobType !== CREATIVE_JOB_TYPE) {
        throw hermesJobError(404, 'HERMES_STUDIO_JOB_NOT_FOUND', 'Creative Hermes job not found');
    }
}

function canDecideStudioJob(user) {
    const roles = [];
    if (user?.role) roles.push(user.role);
    if (Array.isArray(user?.roles)) roles.push(...user.roles);
    if (Array.isArray(user?.extra_roles)) roles.push(...user.extra_roles);
    if (Array.isArray(user?.extraRoles)) roles.push(...user.extraRoles);
    return [...new Set(roles.filter(Boolean).map(role => String(role).trim()))]
        .some(role => STUDIO_DECISION_ROLES.includes(role));
}

function requireStudioDecisionRole(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    if (!canDecideStudioJob(req.user)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
    }
    return next();
}

function decorateStudioJob(job, req) {
    return {
        ...job,
        ui: {
            canDecide: canDecideStudioJob(req.user)
        }
    };
}

function buildStudioJobCreateBody(body, businessContext) {
    assertPlainObject(body, 'HERMES_STUDIO_PAYLOAD_INVALID', 'Request body must be a JSON object');
    assertAllowedFields(body, STUDIO_CREATE_ALLOWED_FIELDS, 'HERMES_STUDIO_UNSUPPORTED_FIELD');

    const title = cleanStudioString(body.title, 240);
    const requirements = cleanStudioString(body.requirements, 4000);
    const source = cleanStudioString(body.source, 500);
    const comment = cleanStudioString(body.comment, 2000);
    const materialType = cleanStudioString(body.materialType || body.material_type, 80);
    const formatSize = cleanStudioString(body.formatSize || body.format_size || body.format || body.size, 120);
    const deadline = cleanStudioString(body.deadline, 120);
    const priority = cleanStudioString(body.priority, 40) || 'normal';

    const sourceEntity = body.sourceEntity && typeof body.sourceEntity === 'object' && !Array.isArray(body.sourceEntity)
        ? body.sourceEntity
        : {
            type: cleanStudioString(body.sourceEntityType || body.source_entity_type, 80) || 'hermes_studio',
            id: cleanStudioString(body.sourceEntityId || body.source_entity_id, 120)
        };

    return {
        jobType: CREATIVE_JOB_TYPE,
        businessContext,
        title,
        sourceEntity,
        dueAt: body.dueAt || body.due_at || deadline || null,
        payload: {
            title,
            source,
            materialType,
            formatSize,
            requirements,
            deadline,
            priority,
            references: normalizeReferenceList(body.references),
            comment,
            brief: [title, source, requirements, comment].filter(Boolean).join('\n\n')
        }
    };
}

function buildRegenerateCreateBody(job, body, businessContext) {
    const sourcePayload = job.sourcePayload || {};
    const notes = cleanStudioString(body.notes || body.comment, 2000);
    const requirements = [
        sourcePayload.requirements,
        notes ? `Regenerate request: ${notes}` : null
    ].filter(Boolean).join('\n\n') || null;

    return {
        jobType: CREATIVE_JOB_TYPE,
        businessContext,
        title: `${job.title || sourcePayload.title || 'Creative material'} / regenerate`,
        sourceEntity: job.sourceEntity?.type
            ? job.sourceEntity
            : { type: 'hermes_studio', id: job.id },
        dueAt: sourcePayload.deadline || job.dueAt || null,
        payload: {
            title: sourcePayload.title || job.title,
            source: sourcePayload.source,
            brief: sourcePayload.brief,
            materialTypes: sourcePayload.materialTypes,
            formats: sourcePayload.formats,
            formatSize: sourcePayload.formatSize,
            requirements,
            deadline: sourcePayload.deadline,
            priority: sourcePayload.priority,
            references: sourcePayload.references,
            comment: sourcePayload.comment,
            brandRules: sourcePayload.brandRules,
            copy: sourcePayload.copy,
            tone: sourcePayload.tone,
            audience: sourcePayload.audience,
            referenceAssetIds: sourcePayload.referenceAssetIds
        }
    };
}

async function withTransaction(queryable, fn) {
    if (!queryable || typeof queryable.connect !== 'function') {
        return fn(queryable);
    }
    const client = await queryable.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        try {
            await client.query('ROLLBACK');
        } catch (rollbackErr) {
            log.warn(`Hermes Studio rollback failed: ${rollbackErr.message}`);
        }
        throw err;
    } finally {
        client.release();
    }
}

function sendError(res, err) {
    const status = err.statusCode || err.status || 500;
    if (status >= 500) {
        log.error('Hermes Studio route failed', err);
    }
    res.status(status).json({
        success: false,
        code: err.code || 'HERMES_STUDIO_ERROR',
        error: err.message || 'Hermes Studio error'
    });
}

function createHermesStudioRouter(options = {}) {
    const router = express.Router();
    const query = options.pool || pool;
    const authMiddleware = options.authMiddleware || authenticateToken;
    const accessGuard = options.accessGuard || requireRole(...STUDIO_ACCESS_ROLES);
    const decisionGuard = options.decisionGuard || requireStudioDecisionRole;

    router.use(authMiddleware);
    router.use(accessGuard);

    router.get('/jobs', async (req, res) => {
        try {
            const businessContext = resolveStudioBusinessContext(req);
            const jobs = await listHermesJobs(query, {
                businessContext,
                jobType: CREATIVE_JOB_TYPE,
                status: req.query.status,
                limit: req.query.limit,
                includeRelations: true
            });
            res.json({
                success: true,
                items: jobs.map(job => decorateStudioJob(job, req)),
                meta: {
                    businessContext,
                    jobType: CREATIVE_JOB_TYPE,
                    canDecide: canDecideStudioJob(req.user)
                }
            });
        } catch (err) {
            sendError(res, err);
        }
    });

    router.get('/jobs/:id', async (req, res) => {
        try {
            const businessContext = resolveStudioBusinessContext(req);
            const job = await getHermesJobDetail(query, req.params.id, businessContext);
            assertCreativeJob(job);
            res.json({
                success: true,
                job: decorateStudioJob(job, req)
            });
        } catch (err) {
            sendError(res, err);
        }
    });

    router.post('/jobs', async (req, res) => {
        try {
            const businessContext = resolveStudioBusinessContext(req);
            const createBody = buildStudioJobCreateBody(req.body || {}, businessContext);
            const created = await createHermesJob(query, createBody, {
                businessContext,
                actor: req.user
            });
            const job = await getHermesJobDetail(query, created.job.id, businessContext);
            res.status(201).json({
                success: true,
                job: decorateStudioJob(job, req)
            });
        } catch (err) {
            sendError(res, err);
        }
    });

    router.post('/jobs/:id/decision', decisionGuard, async (req, res) => {
        try {
            assertPlainObject(req.body || {}, 'HERMES_STUDIO_DECISION_INVALID', 'Request body must be a JSON object');
            assertAllowedFields(req.body || {}, STUDIO_DECISION_ALLOWED_FIELDS, 'HERMES_STUDIO_UNSUPPORTED_FIELD');
            const businessContext = resolveStudioBusinessContext(req);
            const current = await getHermesJobDetail(query, req.params.id, businessContext);
            assertCreativeJob(current);
            const action = cleanStudioString(req.body.action, 80) || req.body.decision;
            const notes = cleanStudioString(req.body.notes || req.body.comment, 4000);
            await recordHermesJobDecision(query, req.params.id, {
                decision: req.body.decision,
                notes,
                payload: {
                    surface: 'hermes_studio',
                    action
                }
            }, {
                businessContext,
                actor: req.user
            });
            const job = await getHermesJobDetail(query, req.params.id, businessContext);
            res.json({
                success: true,
                job: decorateStudioJob(job, req)
            });
        } catch (err) {
            sendError(res, err);
        }
    });

    router.post('/jobs/:id/regenerate', decisionGuard, async (req, res) => {
        try {
            assertPlainObject(req.body || {}, 'HERMES_STUDIO_REGENERATE_INVALID', 'Request body must be a JSON object');
            assertAllowedFields(req.body || {}, STUDIO_DECISION_ALLOWED_FIELDS, 'HERMES_STUDIO_UNSUPPORTED_FIELD');
            const businessContext = resolveStudioBusinessContext(req);
            const current = await getHermesJobDetail(query, req.params.id, businessContext);
            assertCreativeJob(current);
            const notes = cleanStudioString(req.body.notes || req.body.comment, 4000);
            const result = await withTransaction(query, async client => {
                await recordHermesJobDecision(client, req.params.id, {
                    decision: 'revision_requested',
                    notes: notes || 'Regenerate requested',
                    payload: {
                        surface: 'hermes_studio',
                        action: 'regenerate'
                    }
                }, {
                    businessContext,
                    actor: req.user
                });
                return createHermesJob(client, buildRegenerateCreateBody(current, req.body || {}, businessContext), {
                    businessContext,
                    actor: req.user
                });
            });
            const [job, regeneratedJob] = await Promise.all([
                getHermesJobDetail(query, req.params.id, businessContext),
                getHermesJobDetail(query, result.job.id, businessContext)
            ]);
            res.status(201).json({
                success: true,
                job: decorateStudioJob(job, req),
                regeneratedJob: decorateStudioJob(regeneratedJob, req)
            });
        } catch (err) {
            sendError(res, err);
        }
    });

    return router;
}

module.exports = createHermesStudioRouter();
module.exports.createHermesStudioRouter = createHermesStudioRouter;
module.exports.CREATIVE_JOB_TYPE = CREATIVE_JOB_TYPE;
module.exports.STUDIO_ACCESS_ROLES = STUDIO_ACCESS_ROLES;
module.exports.STUDIO_DECISION_ROLES = STUDIO_DECISION_ROLES;

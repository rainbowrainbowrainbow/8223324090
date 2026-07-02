/**
 * routes/leads.js — Leads (hot prospects) API
 * v20.7.0: Lead tracking, follow-up alerts
 * v20.9.13: Full CRUD with booking_id, instagram, source, lost_reason
 * v29.1.0: Sales funnel — lead types, pipeline stages, customer cards,
 *          mailing list, deposit auto-distribute, lost clients
 *
 * Endpoints:
 *   GET    /api/leads                    — list leads (with filters)
 *   GET    /api/leads/hot                — leads needing attention
 *   GET    /api/leads/stats              — funnel stats by status + type
 *   GET    /api/leads/pipeline           — pipeline funnel by stages
 *   POST   /api/leads                    — create lead
 *   PATCH  /api/leads/:id                — update lead
 *   DELETE /api/leads/:id                — delete lead
 *   GET    /api/leads/:id/card           — get customer card
 *   POST   /api/leads/:id/card           — save customer card
 *   GET    /api/leads/mailing            — mailing list
 *   POST   /api/leads/mailing            — add to mailing
 *   DELETE /api/leads/mailing/:id        — remove from mailing
 */
const router = require('express').Router();
const crypto = require('crypto');
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');
const { notifyNewLead } = require('../services/leadNotifier');
const { authenticateToken, requireRole, requireMinRole } = require('../middleware/auth');
const { getVisibleBookingScope } = require('../services/bookingVisibility');
const { buildTaskVisibilityScope } = require('../services/taskPolicy');
const { getAssignableTaskOwner } = require('../services/taskExecution');
const {
    booleanValue,
    deriveReplySlaState,
    isActiveWaitingReply
} = require('../services/replySla');
const {
    DEFAULT_BUSINESS_CONTEXT,
    normalizeBusinessContext,
    businessContextFromRequest,
    requireBusinessContext,
    pushBusinessContextCondition,
    pushBusinessScopeCondition,
    resolveBusinessScope,
    requireBusinessScope,
    requireWritableBusinessScope
} = require('../services/businessContext');
const { normalizeCustomerSource, getCustomerSourceLabel } = require('../services/customerSource');
const {
    createMaysternyaBotBooking,
    createMaysternyaAvailabilityResponse,
    isMaysternyaBookingDryRun
} = require('../services/maysternyaBookingWebhook');
const {
    validateChildBirthday,
    replaceCustomerChildren,
    buildCustomerChildrenProjection,
    buildLegacyChildSnapshot
} = require('../services/customerChildren');

function getKleshnya() { return require('../services/kleshnya'); }
function getBanquetDeposits() { return require('../services/banquetDeposits'); }

const log = createLogger('Leads');

const LEAD_ASSIGNEE_ROLES = ['creator', 'director', 'vice_director', 'senior_manager', 'manager', 'marketer', 'admin'];

// Auto-sync status when pipeline_stage changes
const STAGE_TO_STATUS = {
    new: 'new',
    contacted: 'contact',
    info_sent: 'contact',
    deal: 'proposal',
    deposit_received: 'booked',
    waiting: 'booked',
    completed: 'completed',
    closed: 'completed',
    lost: 'lost'
};

const STATUS_TO_STAGE = {
    new: 'new',
    contact: 'contacted',
    proposal: 'deal',
    booked: 'deposit_received',
    completed: 'completed',
    lost: 'lost'
};

const PIPELINE_STAGE_ORDER = [
    'new',
    'contacted',
    'info_sent',
    'deal',
    'deposit_received',
    'waiting',
    'completed',
    'closed',
    'lost'
];

const VALID_PIPELINE_STAGES = new Set(PIPELINE_STAGE_ORDER);
const CUSTOMER_CARD_PIPELINE_STAGES = new Set([
    'deal',
    'deposit_received',
    'waiting',
    'completed',
    'closed'
]);
const VALID_LEAD_STATUSES = new Set(Object.keys(STATUS_TO_STAGE));
const LEAD_TYPE_ORDER = [
    'quality',
    'spam',
    'collaboration',
    'informational',
    'low_quality'
];
const VALID_LEAD_TYPES = new Set(LEAD_TYPE_ORDER);
const SALES_LEAD_TYPE = 'quality';
const NON_SALES_LEAD_TYPES = LEAD_TYPE_ORDER.filter(type => type !== SALES_LEAD_TYPE);
const LEAD_TYPE_WORKFLOW = {
    spam: {
        pipelineStage: 'lost',
        lostReason: 'Спам'
    },
    collaboration: {
        pipelineStage: 'contacted'
    },
    informational: {
        pipelineStage: 'lost',
        lostReason: 'Інформаційний запит'
    },
    low_quality: {
        pipelineStage: 'lost',
        lostReason: 'Неякісний лід'
    }
};
const LEADS_DEFAULT_LIMIT = 100;
const LEADS_MAX_LIMIT = 500;

const PIPELINE_STAGE_ORDER_SQL = `CASE COALESCE(l.pipeline_stage, 'new')
    ${PIPELINE_STAGE_ORDER.map((stage, index) => `WHEN '${stage}' THEN ${index + 1}`).join(' ')}
    ELSE 999
END`;

const LEAD_STATUS_FROM_STAGE_SQL = `CASE COALESCE(pipeline_stage, 'new')
    ${Object.entries(STAGE_TO_STATUS).map(([stage, status]) => `WHEN '${stage}' THEN '${status}'`).join(' ')}
    ELSE COALESCE(status, 'new')
END`;

function emptyStatusStats() {
    return Object.fromEntries(Object.values(STAGE_TO_STATUS).map(status => [status, 0]));
}

function emptyStageStats() {
    return Object.fromEntries(PIPELINE_STAGE_ORDER.map(stage => [stage, 0]));
}

function emptyLeadTypeStats() {
    return Object.fromEntries(LEAD_TYPE_ORDER.map(type => [type, 0]));
}

const OPTIONAL_WORKSPACE_ERROR_CODES = new Set(['42P01', '42703', '42883']);
const MAYSTERNYA_WEBHOOK_SOURCES = new Set([
    'maysternya_bot',
    'maysternya_site',
    'maysternya_site_test'
]);

const UNIVERSAL_WEBHOOK_TOKEN = process.env.UNIVERSAL_WEBHOOK_TOKEN || '';
const FB_VERIFY_TOKEN         = process.env.FB_VERIFY_TOKEN         || '';

function ensureBusinessContext(req, res) {
    const scope = resolveBusinessScope(req);
    if (!requireBusinessScope(req, res, scope)) return null;
    if (scope.mode !== 'single') {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            requireWritableBusinessScope(req, res, scope);
        } else {
            res.status(400).json({
                success: false,
                error: 'This endpoint requires one active business context',
                code: 'single_business_required'
            });
        }
        return null;
    }
    const businessContext = businessContextFromRequest(req);
    if (!requireBusinessContext(req, res, businessContext)) return null;
    return businessContext;
}

function ensureBusinessScope(req, res) {
    const scope = resolveBusinessScope(req);
    if (!requireBusinessScope(req, res, scope)) return null;
    return scope;
}

function leadContextCondition(params, businessContext, alias = 'l') {
    return pushBusinessContextCondition(params, businessContext || DEFAULT_BUSINESS_CONTEXT, alias);
}

function leadScopeCondition(params, businessScope, alias = 'l') {
    return pushBusinessScopeCondition(params, businessScope || DEFAULT_BUSINESS_CONTEXT, alias);
}

function publicBusinessContext(req) {
    return normalizeBusinessContext(
        req?.body?.businessContext
        || req?.body?.business_context
        || req?.query?.businessContext
        || req?.query?.business_context
        || req?.headers?.['x-business-context']
    );
}

function universalWebhookBusinessContext(req, sourceChannel) {
    if (MAYSTERNYA_WEBHOOK_SOURCES.has(sourceChannel)) return 'maysternya_doli';
    return publicBusinessContext(req);
}

function bearerTokenFromHeader(value) {
    const text = cleanText(value);
    if (!text) return null;
    const match = text.match(/^Bearer\s+(.+)$/i);
    return match ? match[1].trim() : null;
}

function timingSafeTextEqual(actual, expected) {
    if (!actual || !expected) return false;
    const actualBuffer = Buffer.from(String(actual), 'utf8');
    const expectedBuffer = Buffer.from(String(expected), 'utf8');
    return actualBuffer.length === expectedBuffer.length
        && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function truthyWebhookValue(value) {
    if (Array.isArray(value)) return value.some(item => truthyWebhookValue(item));
    const text = String(value ?? '').trim().toLowerCase();
    return ['1', 'true', 'yes', 'y', 'on', 'dryrun', 'dry-run', 'test'].includes(text);
}

function isUniversalWebhookDryRun(req) {
    return truthyWebhookValue(req.query?.dryRun)
        || truthyWebhookValue(req.query?.dry_run)
        || truthyWebhookValue(req.query?.test)
        || truthyWebhookValue(req.body?.dryRun)
        || truthyWebhookValue(req.body?.dry_run)
        || truthyWebhookValue(req.body?.testMode)
        || truthyWebhookValue(req.body?.test)
        || truthyWebhookValue(req.headers?.['x-crm-dry-run']);
}

function parseOptionalPositiveInt(value, fieldName) {
    if (value === undefined) return { provided: false };
    if (value === null || value === '') return { provided: true, value: null };

    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        return { provided: true, error: `${fieldName} повинен бути додатним числом` };
    }

    return { provided: true, value: parsed };
}

function parseOptionalNonNegativeInt(value, fieldName) {
    if (value === undefined) return { provided: false };
    if (value === null || value === '') return { provided: true, value: null };

    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
        return { provided: true, error: `${fieldName} повинен бути цілим невідʼємним числом` };
    }

    return { provided: true, value: parsed };
}

function normalizeKanbanOrder(value, requiredLeadId) {
    if (!Array.isArray(value)) return [];
    const leadId = Number(requiredLeadId);
    const seen = new Set();
    const ids = [];
    for (const rawId of value) {
        const id = Number(rawId);
        if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
        if (ids.length >= 300) break;
    }
    return Number.isInteger(leadId) && leadId > 0 && ids.includes(leadId) ? ids : [];
}

async function persistLeadKanbanOrder(queryable, { businessContext, stage, orderedLeadIds }) {
    const normalizedStage = cleanText(stage) || 'new';
    const ids = Array.isArray(orderedLeadIds) ? orderedLeadIds : [];
    if (!ids.length) return;

    const values = [];
    const params = [];
    ids.forEach((id, index) => {
        params.push(id, (index + 1) * 1000);
        values.push(`($${params.length - 1}::integer, $${params.length}::numeric)`);
    });
    params.push(businessContext, normalizedStage);
    const businessRef = `$${params.length - 1}`;
    const stageRef = `$${params.length}`;

    await queryable.query(
        `WITH ordered(id, position) AS (VALUES ${values.join(', ')})
         UPDATE leads l
            SET kanban_position = ordered.position
           FROM ordered
          WHERE l.id = ordered.id
            AND COALESCE(l.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = ${businessRef}
            AND COALESCE(l.pipeline_stage, 'new') = ${stageRef}`,
        params
    );
}

async function ensureAssignableUser(userId) {
    if (userId === null) return true;
    const result = await pool.query(
        `SELECT id
         FROM users
         WHERE id = $1
           AND is_active = true
           AND role = ANY($2::text[])
         LIMIT 1`,
        [userId, LEAD_ASSIGNEE_ROLES]
    );
    return result.rows.length > 0;
}

function normalizeDigits(value) {
    return String(value || '').replace(/\D/g, '');
}

function normalizeInstagram(value) {
    return String(value || '').trim().replace(/^@+/, '').toLowerCase();
}

function toDateOnly(value) {
    if (!value) return null;
    if (typeof value === 'string') return value.slice(0, 10);
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
    return String(value).slice(0, 10);
}

function parseJsonArray(value) {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function parseJsonObject(value) {
    if (!value) return {};
    if (typeof value === 'object' && !Array.isArray(value)) return value;
    if (typeof value !== 'string') return {};
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function cleanText(value) {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    return text || null;
}

function firstClean(...values) {
    for (const value of values) {
        const text = cleanText(value);
        if (text) return text;
    }
    return null;
}

function normalizeWebhookSource(value) {
    return String(value || 'universal')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 50) || 'universal';
}

function normalizeTelegramId(value) {
    const text = cleanText(value);
    if (!text || !/^\d{1,20}$/.test(text)) return null;
    return text;
}

function normalizeDateOnly(value) {
    const dateOnly = toDateOnly(value);
    return dateOnly && /^\d{4}-\d{2}-\d{2}$/.test(dateOnly) ? dateOnly : null;
}

function normalizeLeadPatchStageStatus({ pipelineStage, status }) {
    const hasStage = pipelineStage !== undefined;
    const hasStatus = status !== undefined;
    const normalizedStage = cleanText(pipelineStage);
    const normalizedStatus = cleanText(status);

    if (hasStage) {
        if (!normalizedStage || !VALID_PIPELINE_STAGES.has(normalizedStage)) {
            return { error: 'Некоректний pipeline_stage' };
        }
        return {
            stageProvided: true,
            stage: normalizedStage,
            status: STAGE_TO_STATUS[normalizedStage]
        };
    }

    if (hasStatus) {
        if (!normalizedStatus || !VALID_LEAD_STATUSES.has(normalizedStatus)) {
            return { error: 'Некоректний status' };
        }
        const stage = STATUS_TO_STAGE[normalizedStatus];
        return {
            stageProvided: true,
            stage,
            status: STAGE_TO_STATUS[stage]
        };
    }

    return { stageProvided: false };
}

function normalizeLeadType(value) {
    const normalized = cleanText(value);
    if (!normalized || !VALID_LEAD_TYPES.has(normalized)) {
        return { error: 'Некоректний lead_type' };
    }
    return { value: normalized };
}

function leadTypeWorkflowRule(leadType) {
    return LEAD_TYPE_WORKFLOW[leadType] || null;
}

function shouldAddLeadToMailing(lead, stage) {
    const type = lead?.lead_type || 'quality';
    if (type === 'spam') return false;
    if (type === 'informational') return true;
    return stage === 'lost';
}

function todayKyivDateString() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Kyiv' });
}

const COLLABORATION_TASK_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);

function normalizeCollaborationTaskPriority(value) {
    const priority = cleanText(value) || 'normal';
    return COLLABORATION_TASK_PRIORITIES.has(priority) ? priority : 'normal';
}

function collaborationLeadContact(lead = {}) {
    return [
        cleanText(lead.phone),
        cleanText(lead.instagram) ? `@${String(lead.instagram).trim().replace(/^@+/, '')}` : null
    ].filter(Boolean).join(' / ');
}

function defaultCollaborationTaskTitle(lead = {}) {
    const contact = collaborationLeadContact(lead);
    return `Співпраця: ${cleanText(lead.client_name) || contact || `лід #${lead.id}`}`;
}

function defaultCollaborationTaskDescription(lead = {}, comment = '') {
    const contact = collaborationLeadContact(lead);
    return [
        `Запит на співпрацю з ліда #${lead.id}.`,
        cleanText(lead.client_name) ? `Контакт: ${cleanText(lead.client_name)}` : null,
        contact ? `Канал: ${contact}` : null,
        cleanText(lead.notes) ? `Нотатки ліда: ${String(lead.notes).slice(0, 600)}` : null,
        cleanText(comment) ? `Коментар менеджера: ${cleanText(comment)}` : null
    ].filter(Boolean).join('\n');
}

function buildCollaborationTaskPayload(lead, body = {}, owner = {}, user = {}, businessContext = DEFAULT_BUSINESS_CONTEXT) {
    const title = cleanText(body.title) || defaultCollaborationTaskTitle(lead);
    const deadline = cleanText(body.deadline);
    const date = normalizeDateOnly(body.date || deadline);
    if (!title) return { error: 'Назва задачі обовʼязкова' };
    if (!deadline || !date) return { error: 'Дедлайн задачі обовʼязковий' };

    const ownerLabel = owner.label || owner.name || owner.username || null;
    return {
        businessContext,
        title,
        description: cleanText(body.description) || defaultCollaborationTaskDescription(lead, body.comment),
        date,
        deadline,
        priority: normalizeCollaborationTaskPriority(body.priority),
        assigned_to: ownerLabel,
        owner: ownerLabel,
        owner_user_id: owner.id,
        task_type: 'human',
        category: 'operational',
        source_type: 'lead',
        source_id: String(lead.id),
        source_entity_type: 'lead',
        source_entity_id: String(lead.id),
        created_by: user?.username || user?.id || 'lead_collaboration',
        created_by_user_id: user?.id || null,
        control_meta: {
            source: 'leads.collaboration_task',
            leadTypeWorkflow: true
        },
        duplicateMode: 'reject'
    };
}

async function logCollaborationWorkflow(queryable, { oldLead, updatedLead, task, userId }) {
    const oldStage = oldLead?.pipeline_stage || 'new';
    const newStage = updatedLead?.pipeline_stage || 'contacted';
    const oldStatus = oldLead?.status || STAGE_TO_STATUS[oldStage] || 'new';
    const newStatus = updatedLead?.status || STAGE_TO_STATUS[newStage] || 'contact';
    const oldLeadType = oldLead?.lead_type || SALES_LEAD_TYPE;
    await queryable.query(`
        INSERT INTO lead_interactions (lead_id, user_id, type, summary, details, created_at)
        VALUES ($1, $2, 'status_change', $3, $4::jsonb, NOW())
    `, [
        updatedLead.id,
        userId || null,
        `Lead type workflow: ${oldLeadType} -> collaboration`,
        JSON.stringify({
            oldLeadType,
            newLeadType: 'collaboration',
            oldStage,
            newStage,
            oldStatus,
            newStatus,
            taskId: task?.id || null,
            source: 'leads.collaboration_task'
        })
    ]);
}

function runAfterCommitCallbacks(callbacks = []) {
    callbacks.forEach(callback => {
        try { callback(); }
        catch (err) { log.error('Lead collaboration after-commit callback failed', err); }
    });
}

function parseLeadListLimit(value) {
    const parsed = parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) return LEADS_DEFAULT_LIMIT;
    return Math.min(parsed, LEADS_MAX_LIMIT);
}

function parseLeadListOffset(value) {
    const parsed = parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function buildLeadListFilters(query, businessScope) {
    const { status, assigned_to, source, search, pipeline_stage, lead_type } = query;
    const conditions = [];
    const params = [];
    conditions.push(leadScopeCondition(params, businessScope, 'l'));

    if (pipeline_stage) {
        const normalizedStage = cleanText(pipeline_stage);
        if (!normalizedStage || !VALID_PIPELINE_STAGES.has(normalizedStage)) {
            return { error: 'Некоректний pipeline_stage' };
        }
        params.push(normalizedStage);
        conditions.push(`COALESCE(l.pipeline_stage, 'new') = $${params.length}`);
    }
    if (status && !pipeline_stage) {
        const normalizedStatus = cleanText(status);
        if (!normalizedStatus || !VALID_LEAD_STATUSES.has(normalizedStatus)) {
            return { error: 'Некоректний status' };
        }
        const matchingStages = PIPELINE_STAGE_ORDER.filter(stage => STAGE_TO_STATUS[stage] === normalizedStatus);
        if (!matchingStages.includes(STATUS_TO_STAGE[normalizedStatus])) matchingStages.push(STATUS_TO_STAGE[normalizedStatus]);
        params.push(matchingStages);
        conditions.push(`COALESCE(l.pipeline_stage, 'new') = ANY($${params.length}::text[])`);
    }
    if (assigned_to) {
        const assignedId = parseInt(assigned_to, 10);
        if (!Number.isInteger(assignedId)) return { error: 'assigned_to повинен бути числом' };
        params.push(assignedId);
        conditions.push(`l.assigned_to = $${params.length}`);
    }
    if (source) {
        params.push(source);
        conditions.push(`l.source = $${params.length}`);
    }
    if (lead_type) {
        const normalizedLeadType = normalizeLeadType(lead_type);
        if (normalizedLeadType.error) return { error: normalizedLeadType.error };
        params.push(normalizedLeadType.value);
        conditions.push(`COALESCE(NULLIF(l.lead_type, ''), '${SALES_LEAD_TYPE}') = $${params.length}`);
    }
    if (search) {
        const pattern = `%${search}%`;
        params.push(pattern);
        conditions.push(`(l.client_name ILIKE $${params.length} OR l.phone ILIKE $${params.length} OR l.instagram ILIKE $${params.length})`);
    }
    if (query.event_date) {
        params.push(query.event_date);
        conditions.push(`l.event_date::date = $${params.length}::date`);
    }

    return {
        where: conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '',
        params
    };
}

function leadListOrderSql(order) {
    return order === 'kanban'
        ? `ORDER BY ${PIPELINE_STAGE_ORDER_SQL}, l.kanban_position ASC NULLS LAST, l.created_at DESC`
        : 'ORDER BY l.created_at DESC';
}

async function fetchLeadList({ businessScope, query = {}, order = query.order, limit, offset }) {
    const filters = buildLeadListFilters(query, businessScope);
    if (filters.error) return { error: filters.error };

    const countResult = await pool.query(
        `SELECT COUNT(*)::int AS total
         FROM leads l
         ${filters.where}`,
        filters.params
    );
    const total = parseInt(countResult.rows[0]?.total || 0, 10);
    const effectiveLimit = parseLeadListLimit(limit ?? query.limit);
    const effectiveOffset = parseLeadListOffset(offset ?? query.offset);
    const params = [...filters.params, effectiveLimit, effectiveOffset];
    const limitRef = `$${params.length - 1}`;
    const offsetRef = `$${params.length}`;
    const result = await pool.query(`
        SELECT l.*, u.name AS assigned_name, p.label AS program_name,
               COALESCE(l.potential_value, latest_card.budget_approx) AS budget_approx
        FROM leads l
        LEFT JOIN users u ON l.assigned_to = u.id
        LEFT JOIN products p ON l.program_id = p.id
        LEFT JOIN LATERAL (
            SELECT cc.budget_approx
            FROM customer_cards cc
            WHERE cc.lead_id = l.id
              AND COALESCE(cc.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = COALESCE(l.business_context, '${DEFAULT_BUSINESS_CONTEXT}')
              AND cc.budget_approx IS NOT NULL
            ORDER BY cc.updated_at DESC NULLS LAST, cc.id DESC
            LIMIT 1
        ) latest_card ON true
        ${filters.where}
        ${leadListOrderSql(order)}
        LIMIT ${limitRef} OFFSET ${offsetRef}
    `, params);

    return {
        leads: result.rows,
        pagination: {
            total,
            limit: effectiveLimit,
            offset: effectiveOffset,
            nextOffset: effectiveOffset + result.rows.length,
            hasMore: effectiveOffset + result.rows.length < total
        }
    };
}

function normalizeTextList(value) {
    if (Array.isArray(value)) {
        return value.map(cleanText).filter(Boolean).slice(0, 12);
    }
    const parsed = parseJsonArray(value);
    if (parsed.length) return parsed.map(cleanText).filter(Boolean).slice(0, 12);
    const text = cleanText(value);
    return text ? text.split(/[,;]+/).map(cleanText).filter(Boolean).slice(0, 12) : [];
}

function normalizeUtm(raw = {}) {
    const utm = parseJsonObject(raw.utm);
    const mapped = {
        source: firstClean(utm.source, utm.utm_source, raw.utm_source, raw.utmSource),
        medium: firstClean(utm.medium, utm.utm_medium, raw.utm_medium, raw.utmMedium),
        campaign: firstClean(utm.campaign, utm.utm_campaign, raw.utm_campaign, raw.utmCampaign),
        content: firstClean(utm.content, utm.utm_content, raw.utm_content, raw.utmContent),
        term: firstClean(utm.term, utm.utm_term, raw.utm_term, raw.utmTerm)
    };
    return Object.fromEntries(Object.entries(mapped).filter(([, value]) => Boolean(value)));
}

function normalizeUniversalWebhookEnvelope(body = {}) {
    const root = parseJsonObject(body);
    const payload = parseJsonObject(
        root.payload
        || root.data
        || root.event_payload
        || root.eventPayload
        || root.record
    );
    const lead = parseJsonObject(root.lead || payload.lead || payload.customer_lead || payload.customerLead);
    const booking = parseJsonObject(root.booking || payload.booking || payload.appointment || payload.session);
    const customer = parseJsonObject(
        root.customer
        || root.client
        || payload.customer
        || payload.client
        || lead.customer
        || booking.customer
        || booking.client
    );
    const contact = parseJsonObject(
        root.contact
        || payload.contact
        || lead.contact
        || customer.contact
        || booking.contact
    );
    const telegram = parseJsonObject(root.telegram || payload.telegram || lead.telegram || customer.telegram || contact.telegram);

    const eventType = firstClean(
        root.event_type,
        root.eventType,
        root.event,
        root.type,
        payload.event_type,
        payload.eventType,
        payload.event,
        payload.type
    );
    const eventId = firstClean(
        root.event_id,
        root.eventId,
        root.id,
        payload.event_id,
        payload.eventId
    );
    const bookingId = firstClean(
        root.booking_id,
        root.bookingId,
        payload.booking_id,
        payload.bookingId,
        booking.id,
        booking.external_id,
        booking.externalId
    );
    const leadId = firstClean(
        root.lead_id,
        root.leadId,
        payload.lead_id,
        payload.leadId,
        lead.id,
        lead.external_id,
        lead.externalId
    );

    return {
        ...root,
        ...payload,
        ...lead,
        ...customer,
        ...contact,
        telegram,
        crm_event_type: eventType || null,
        crm_event_id: eventId || null,
        crm_booking_id: bookingId || null,
        crm_lead_id: leadId || null,
        external_id: firstClean(
            root.external_id,
            root.externalId,
            payload.external_id,
            payload.externalId,
            lead.external_id,
            lead.externalId,
            leadId,
            booking.lead_external_id,
            booking.leadExternalId,
            bookingId ? `booking:${bookingId}` : null
        ),
        lead_id: leadId,
        booking_id: bookingId,
        name: firstClean(root.name, root.client_name, payload.name, payload.client_name, lead.name, customer.name, contact.name),
        client_name: firstClean(root.client_name, root.clientName, payload.client_name, payload.clientName, lead.client_name, lead.clientName, customer.name),
        phone: firstClean(root.phone, payload.phone, lead.phone, customer.phone, contact.phone, booking.phone),
        telegram_id: firstClean(root.telegram_id, root.telegramId, payload.telegram_id, payload.telegramId, lead.telegram_id, customer.telegram_id, telegram.id, telegram.user_id),
        telegram_username: firstClean(root.telegram_username, root.telegramUsername, payload.telegram_username, payload.telegramUsername, lead.telegram_username, customer.telegram_username, telegram.username),
        contact_channels: root.contact_channels ?? root.contactChannels ?? payload.contact_channels ?? payload.contactChannels ?? lead.contact_channels ?? customer.contact_channels,
        request_topic: firstClean(root.request_topic, root.requestTopic, payload.request_topic, payload.requestTopic, lead.request_topic, customer.request_topic),
        topic: firstClean(root.topic, payload.topic, lead.topic, booking.topic),
        session_type: firstClean(root.session_type, root.sessionType, payload.session_type, payload.sessionType, lead.session_type, booking.session_type, booking.service, booking.service_name),
        booking_date: firstClean(root.booking_date, root.bookingDate, payload.booking_date, payload.bookingDate, booking.booking_date, booking.bookingDate, booking.date, root.date, payload.date),
        booking_time: firstClean(root.booking_time, root.bookingTime, payload.booking_time, payload.bookingTime, booking.booking_time, booking.bookingTime, booking.time, root.time, payload.time),
        message: firstClean(root.message, payload.message, lead.message, booking.message, root.comment, payload.comment, root.notes, payload.notes),
        status: firstClean(root.status, payload.status, lead.status, booking.status),
        payment_status: firstClean(root.payment_status, root.paymentStatus, payload.payment_status, payload.paymentStatus, booking.payment_status, booking.paymentStatus),
        amount: firstClean(root.amount, payload.amount, booking.amount, booking.price, booking.total),
        raw_envelope: root
    };
}

function buildLeadInboundMetadata(row = {}) {
    const raw = parseJsonObject(row.raw_payload);
    const normalized = parseJsonObject(raw.normalized);
    const contactChannels = normalizeTextList(
        normalized.contact_channels
        ?? raw.contact_channels
        ?? raw.contactChannels
        ?? raw.channels
    );
    return {
        externalId: firstClean(row.external_id, raw.external_id, raw.externalId, raw.lead_id, raw.leadId),
        eventType: firstClean(normalized.crm_event_type, raw.crm_event_type, raw.crmEventType, raw.event_type, raw.eventType, raw.event),
        eventId: firstClean(normalized.crm_event_id, raw.crm_event_id, raw.crmEventId, raw.event_id, raw.eventId),
        bookingId: firstClean(normalized.crm_booking_id, raw.crm_booking_id, raw.crmBookingId, raw.booking_id, raw.bookingId),
        inquiryId: firstClean(raw.inquiryId, raw.inquiry_id, raw.requestId, raw.request_id),
        email: firstClean(raw.email, raw.contact_email, raw.contactEmail),
        page: firstClean(raw.page, raw.page_url, raw.pageUrl, raw.url, raw.referrer),
        topic: firstClean(normalized.request_topic, raw.request_topic, raw.requestTopic, raw.topic, raw.subject),
        message: firstClean(raw.message, raw.comment, raw.notes, raw.description),
        sessionType: firstClean(normalized.session_type, raw.session_type, raw.sessionType, raw.record_type, raw.booking_type),
        bookingTime: firstClean(normalized.booking_time, raw.booking_time, raw.bookingTime, raw.slot_time, raw.time),
        contactChannels,
        utm: normalizeUtm(raw),
        createdAt: firstClean(raw.createdAt, raw.created_at)
    };
}

function stripAt(value) {
    const text = cleanText(value);
    return text ? text.replace(/^@+/, '') : null;
}

function normalizeUniversalWebhookPayload(body = {}, sourceChannel = 'universal') {
    const normalizedBody = normalizeUniversalWebhookEnvelope(body);
    const telegram = normalizedBody.telegram && typeof normalizedBody.telegram === 'object'
        ? normalizedBody.telegram
        : {};
    const telegramId = normalizeTelegramId(firstClean(
        normalizedBody.telegram_id,
        normalizedBody.telegramId,
        normalizedBody.tg_id,
        normalizedBody.tgId,
        telegram.id,
        telegram.user_id,
        normalizedBody.telegram?.id,
        normalizedBody.telegram?.user_id
    ));
    const telegramUsername = stripAt(firstClean(
        normalizedBody.telegram_username,
        normalizedBody.telegramUsername,
        normalizedBody.tg_username,
        normalizedBody.username,
        telegram.username,
        normalizedBody.telegram?.username
    ));
    const phone = firstClean(
        normalizedBody.phone,
        normalizedBody.phone_number,
        normalizedBody.phoneNumber,
        normalizedBody.contact_phone,
        normalizedBody.contactPhone,
        normalizedBody.contact,
        normalizedBody.contact_value,
        normalizedBody.contactValue
    );
    const whatsapp = firstClean(normalizedBody.whatsapp, normalizedBody.whatsapp_phone, normalizedBody.whatsappPhone);
    const name = firstClean(normalizedBody.name, normalizedBody.client_name, normalizedBody.clientName, normalizedBody.full_name, normalizedBody.fullName);
    const requestTopic = firstClean(normalizedBody.request_topic, normalizedBody.requestTopic, normalizedBody.topic, normalizedBody.subject);
    const sessionType = firstClean(normalizedBody.session_type, normalizedBody.sessionType, normalizedBody.record_type, normalizedBody.booking_type);
    const bookingDate = normalizeDateOnly(firstClean(normalizedBody.booking_date, normalizedBody.bookingDate, normalizedBody.slot_date, normalizedBody.date));
    const bookingTime = firstClean(normalizedBody.booking_time, normalizedBody.bookingTime, normalizedBody.slot_time, normalizedBody.time);
    const message = firstClean(normalizedBody.message, normalizedBody.comment, normalizedBody.notes, normalizedBody.description);
    const externalId = firstClean(normalizedBody.external_id, normalizedBody.externalId, normalizedBody.lead_id, normalizedBody.leadId);
    const contactChannels = normalizeTextList(normalizedBody.contact_channels ?? normalizedBody.contactChannels ?? normalizedBody.channels);
    const fallbackExternalId = externalId
        || (telegramId ? `telegram:${telegramId}` : null);
    const hasContactSignal = Boolean(name || phone || telegramId || telegramUsername || whatsapp || externalId);

    return {
        contact_signal: hasContactSignal,
        client_name: name || (telegramUsername ? `@${telegramUsername}` : null) || phone || whatsapp || fallbackExternalId || 'Невідомий контакт',
        phone: phone || null,
        telegram_id: telegramId,
        telegram_username: telegramUsername,
        whatsapp: whatsapp || null,
        instagram: stripAt(normalizedBody.instagram),
        request_topic: requestTopic,
        session_type: sessionType,
        event_date: bookingDate,
        booking_time: bookingTime,
        contact_channels: contactChannels,
        message,
        external_id: fallbackExternalId,
        raw_payload: {
            ...normalizedBody.raw_envelope,
            normalized: {
                source_channel: sourceChannel,
                crm_event_type: normalizedBody.crm_event_type,
                crm_event_id: normalizedBody.crm_event_id,
                crm_booking_id: normalizedBody.crm_booking_id,
                crm_lead_id: normalizedBody.crm_lead_id,
                telegram_id: telegramId,
                telegram_username: telegramUsername,
                whatsapp: whatsapp || null,
                contact_channels: contactChannels,
                request_topic: requestTopic,
                session_type: sessionType,
                booking_date: bookingDate,
                booking_time: bookingTime
            }
        }
    };
}

function universalWebhookDryRunPreview(payload, businessContext, sourceChannel) {
    const inbound = buildLeadInboundMetadata({
        external_id: payload.external_id,
        raw_payload: payload.raw_payload
    });
    return {
        businessContext,
        sourceChannel,
        externalId: payload.external_id || inbound.externalId || null,
        eventType: inbound.eventType || null,
        eventId: inbound.eventId || null,
        inquiryId: inbound.inquiryId || null,
        clientName: payload.client_name || null,
        phone: payload.phone || null,
        email: inbound.email || null,
        page: inbound.page || null,
        topic: inbound.topic || null,
        message: inbound.message || null,
        sessionType: inbound.sessionType || null,
        contactChannels: payload.contact_channels?.length ? payload.contact_channels : inbound.contactChannels,
        utm: inbound.utm
    };
}

function formatUniversalLeadNotes(payload, sourceChannel) {
    const lines = [
        `Джерело: ${sourceChannel}`,
        payload.raw_payload?.normalized?.crm_event_type ? `CRM event: ${payload.raw_payload.normalized.crm_event_type}` : null,
        payload.raw_payload?.normalized?.crm_booking_id ? `Booking ID: ${payload.raw_payload.normalized.crm_booking_id}` : null,
        payload.request_topic ? `Тема: ${payload.request_topic}` : null,
        payload.session_type ? `Тип сесії: ${payload.session_type}` : null,
        (payload.event_date || payload.booking_time)
            ? `Запис: ${[payload.event_date, payload.booking_time].filter(Boolean).join(' ')}`
            : null,
        (payload.telegram_username || payload.telegram_id)
            ? `Telegram: ${[payload.telegram_username ? `@${payload.telegram_username}` : null, payload.telegram_id ? `ID ${payload.telegram_id}` : null].filter(Boolean).join(' / ')}`
            : null,
        payload.whatsapp ? `WhatsApp: ${payload.whatsapp}` : null,
        payload.contact_channels.length ? `Канали: ${payload.contact_channels.join(', ')}` : null,
        payload.message ? `Коментар: ${payload.message}` : null
    ];
    return lines.filter(Boolean).join('\n');
}

function formatWebhookNoteEntry(notes, sourceChannel) {
    const body = cleanText(notes);
    if (!body) return null;
    return `[${sourceChannel} ${new Date().toISOString()}]\n${body}`;
}

function hasLeadContactSignal(payload) {
    return Boolean(payload.contact_signal);
}

async function findExistingWebhookLead(payload, businessContext, sourceChannel = null) {
    if (payload.external_id) {
        const exact = await pool.query(
            `SELECT id FROM leads
             WHERE COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $1
               AND external_id = $2
               AND source_channel = $3
             LIMIT 1`,
            [businessContext, payload.external_id, sourceChannel]
        );
        if (exact.rows.length > 0) return exact.rows[0];
    }

    return null;
}

async function upsertUniversalWebhookLead(payload, businessContext, sourceChannel, notes) {
    const existing = await findExistingWebhookLead(payload, businessContext, sourceChannel);
    if (existing) {
        const update = await pool.query(
            `UPDATE leads
                SET client_name = COALESCE($1, client_name),
                    phone = COALESCE($2, phone),
                    telegram_id = COALESCE($3::bigint, telegram_id),
                    instagram = COALESCE($4, instagram),
                    source = COALESCE($5, source),
                    source_channel = COALESCE($6, source_channel),
                    external_id = COALESCE($7, external_id),
                    event_date = COALESCE($8::date, event_date),
                    quality_category = COALESCE($9, quality_category),
                    notes = CASE
                        WHEN $10::text IS NULL THEN notes
                        ELSE CONCAT_WS(E'\n', NULLIF(notes, ''), $10::text)
                    END,
                    raw_payload = COALESCE(raw_payload, '{}'::jsonb) || COALESCE($11::jsonb, '{}'::jsonb),
                    last_contact_at = NOW()
              WHERE id = $12
                AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $13
              RETURNING *`,
            [
                payload.client_name || null,
                payload.phone || null,
                payload.telegram_id || null,
                payload.instagram || null,
                sourceChannel,
                sourceChannel,
                payload.external_id || null,
                payload.event_date || null,
                payload.session_type || null,
                formatWebhookNoteEntry(notes, sourceChannel),
                JSON.stringify(payload.raw_payload || {}),
                existing.id,
                businessContext
            ]
        );
        return { lead: update.rows[0] || null, created: false };
    }

    const insert = await pool.query(
        `INSERT INTO leads
           (business_context, client_name, phone, telegram_id, instagram,
            source, source_channel, external_id, notes, raw_payload, status,
            event_date, quality_category)
         VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9::jsonb,'new',$10::date,$11)
         ON CONFLICT (business_context, source_channel, external_id)
           WHERE external_id IS NOT NULL DO NOTHING
         RETURNING *`,
        [
            businessContext,
            payload.client_name || null,
            payload.phone || null,
            payload.telegram_id || null,
            payload.instagram || null,
            sourceChannel,
            payload.external_id || null,
            notes || null,
            JSON.stringify(payload.raw_payload || {}),
            payload.event_date || null,
            payload.session_type || null
        ]
    );
    return { lead: insert.rows[0] || null, created: insert.rows.length > 0 };
}

async function handleUniversalWebhook(req, res) {
    try {
        const token = bearerTokenFromHeader(req.headers['authorization']);
        if (!timingSafeTextEqual(token, UNIVERSAL_WEBHOOK_TOKEN)) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const sourceChannel = normalizeWebhookSource(req.query.source || 'universal');
        const businessContext = universalWebhookBusinessContext(req, sourceChannel);
        const payload = normalizeUniversalWebhookPayload(req.body || {}, sourceChannel);
        const notes = formatUniversalLeadNotes(payload, sourceChannel);

        if (!hasLeadContactSignal(payload)) {
            return res.status(400).json({ error: "Потрібно ім'я або контакт" });
        }

        if (isUniversalWebhookDryRun(req)) {
            return res.json({
                ok: true,
                success: true,
                dryRun: true,
                created: false,
                updated: false,
                lead: null,
                preview: universalWebhookDryRunPreview(payload, businessContext, sourceChannel)
            });
        }

        const result = await upsertUniversalWebhookLead(payload, businessContext, sourceChannel, notes);
        if (result.created && result.lead) {
            notifyNewLead(result.lead).catch(() => {});
            log.info(`New lead via universal [${sourceChannel}]: ${payload.client_name || payload.phone}`);
        }

        res.json({
            ok: true,
            success: true,
            created: result.created,
            updated: Boolean(result.lead && !result.created),
            lead: result.lead ? { id: result.lead.id } : null
        });
    } catch (err) {
        log.error('Universal webhook error', err);
        res.status(500).json({ error: 'Internal error' });
    }
}

async function handleMaysternyaBookingWebhook(req, res) {
    try {
        const token = bearerTokenFromHeader(req.headers['authorization']);
        if (!timingSafeTextEqual(token, UNIVERSAL_WEBHOOK_TOKEN)) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const result = await createMaysternyaBotBooking(req.body || {}, {
            dryRun: isMaysternyaBookingDryRun(req)
        });
        if (result.error) {
            const error = result.error;
            return res.status(error.statusCode || 400).json({
                success: false,
                ok: false,
                error: error.message || 'Maysternya booking webhook failed',
                code: error.code || 'maysternya_booking_error',
                missingFields: error.missingFields || undefined,
                conflictBookingId: error.conflictBookingId || undefined
            });
        }
        return res.json(result.response);
    } catch (err) {
        log.error('Maysternya booking webhook error', err);
        return res.status(err.statusCode || 500).json({
            success: false,
            ok: false,
            error: err.publicMessage || err.message || 'Internal error',
            code: err.code || 'internal_error'
        });
    }
}

async function handleMaysternyaAvailabilityWebhook(req, res) {
    try {
        const token = bearerTokenFromHeader(req.headers['authorization']);
        if (!timingSafeTextEqual(token, UNIVERSAL_WEBHOOK_TOKEN)) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const result = await createMaysternyaAvailabilityResponse(req.body || {});
        if (result.error) {
            const error = result.error;
            return res.status(error.statusCode || 400).json({
                success: false,
                ok: false,
                error: error.message || 'Maysternya availability webhook failed',
                code: error.code || 'maysternya_availability_error',
                missingFields: error.missingFields || undefined,
                conflictBookingId: error.conflictBookingId || undefined
            });
        }
        return res.json(result.response);
    } catch (err) {
        log.error('Maysternya availability webhook error', err);
        return res.status(err.statusCode || 500).json({
            success: false,
            ok: false,
            error: err.publicMessage || err.message || 'Internal error',
            code: err.code || 'internal_error'
        });
    }
}

function normalizeCelebrants(value, legacy = {}) {
    const items = [];
    const rawItems = parseJsonArray(value);
    for (const item of rawItems) {
        if (!item || typeof item !== 'object') continue;
        const name = cleanText(item.name || item.childName || item.child_name);
        const ageRaw = item.age ?? item.childAge ?? item.child_age;
        const age = ageRaw === undefined || ageRaw === null || ageRaw === ''
            ? null
            : Number(ageRaw);
        const birthday = cleanText(item.birthday || item.birthDate || item.birth_date);
        const notes = cleanText(item.notes);
        if (!name && !Number.isFinite(age) && !birthday && !notes) continue;
        items.push({
            name,
            age: Number.isFinite(age) && age >= 0 && age <= 120 ? age : null,
            birthday: birthday && /^\d{4}-\d{2}-\d{2}$/.test(birthday) ? birthday : null,
            notes,
            source: cleanText(item.source) || 'operator'
        });
        if (items.length >= 20) break;
    }

    if (!items.length && (legacy.childAge || legacy.childrenCount)) {
        items.push({
            name: null,
            age: Number.isFinite(Number(legacy.childAge)) ? Number(legacy.childAge) : null,
            birthday: null,
            notes: null,
            source: 'legacy_single_child'
        });
    }

    return items;
}

function leadSocialIdentities(lead = {}) {
    const identities = [];
    const instagram = normalizeInstagram(lead.instagram);
    if (instagram) {
        identities.push({ channel: 'instagram', handle: instagram, source: 'lead_link' });
    }
    const channel = cleanText(lead.source_channel || lead.source);
    const telegram = cleanText(lead.telegram_id);
    if (channel && channel !== 'instagram') {
        identities.push({
            channel,
            handle: telegram || normalizeDigits(lead.phone) || cleanText(lead.client_name),
            source: 'lead_link'
        });
    }
    return identities.filter(identity => identity.channel && identity.handle);
}

function mergeLeadSocialIdentities(existingValue, lead = {}) {
    const items = [...parseJsonArray(existingValue), ...leadSocialIdentities(lead)];
    const merged = [];
    const seen = new Set();
    for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const channel = cleanText(item.channel || item.type || item.provider);
        const handle = cleanText(item.handle || item.username || item.value || item.externalId || item.external_id);
        if (!channel || !handle) continue;
        const normalized = {
            channel: channel.toLowerCase(),
            handle: channel.toLowerCase() === 'instagram' ? handle.replace(/^@+/, '') : handle,
            source: cleanText(item.source) || 'operator'
        };
        const key = `${normalized.channel}:${normalized.handle.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(normalized);
        if (merged.length >= 12) break;
    }
    return merged;
}

function leadCustomerSource(lead = {}) {
    return normalizeCustomerSource(lead.source || lead.source_channel || 'lead', { unknownAsNull: false });
}

function leadCustomerName(lead = {}) {
    return firstClean(lead.client_name, lead.name) || `Lead #${lead.id}`;
}

function leadCustomerChildName(lead = {}) {
    const celebrants = leadCustomerChildren(lead);
    return firstClean(...celebrants.map(item => item.name));
}

function safeLeadChildBirthday(value) {
    try {
        return validateChildBirthday(value, 'lead.celebrants[].birthday');
    } catch {
        return null;
    }
}

function leadCustomerChildren(lead = {}) {
    const celebrants = normalizeCelebrants(lead.celebrants, {
        childrenCount: lead.children_count,
        childAge: lead.child_age
    });
    return celebrants
        .map(item => ({
            name: cleanText(item.name),
            birthday: safeLeadChildBirthday(item.birthday),
            ageSnapshot: Number.isInteger(item.age) ? item.age : null,
            note: cleanText(item.notes)
        }))
        .filter(item => item.name || item.birthday || item.ageSnapshot !== null || item.note);
}

async function syncLeadCelebrantsToCustomerChildren(queryable, lead = {}, customer = null, businessContext = DEFAULT_BUSINESS_CONTEXT) {
    const leadId = parseInt(lead.id, 10);
    const customerId = parseInt(customer?.id, 10);
    if (!Number.isInteger(leadId) || leadId <= 0 || !Number.isInteger(customerId) || customerId <= 0) {
        return { customer, children: [] };
    }

    const normalizedBusinessContext = normalizeBusinessContext(businessContext) || DEFAULT_BUSINESS_CONTEXT;
    const children = leadCustomerChildren(lead);
    const rawCelebrants = parseJsonArray(lead.celebrants);
    const legacyChildSnapshot = buildLegacyChildSnapshot(children, {
        childName: leadCustomerChildName(lead)
    });
    const savedChildren = await replaceCustomerChildren(
        customerId,
        children,
        normalizedBusinessContext,
        {
            sourceKind: 'lead_celebrant',
            source: 'leads.celebrants',
            copyRule: rawCelebrants.length ? 'explicit_lead_celebrants' : 'legacy_lead_child_fields',
            sourceLeadId: leadId,
            sortOrderBase: 10,
            sourcePayload: {
                source_table: 'leads',
                source_lead_id: leadId,
                source_customer_id: customerId,
                lead_celebrants: rawCelebrants,
                children_count: lead.children_count ?? null,
                child_age: lead.child_age ?? null,
                original_lead_child_name_snapshot: legacyChildSnapshot.childName
            }
        },
        { client: queryable }
    );

    const firstChildName = legacyChildSnapshot.childName;
    const updated = await queryable.query(
        `UPDATE customers
         SET child_name = CASE
                 WHEN lead_id = $4 THEN $1
                 WHEN NULLIF(child_name, '') IS NULL THEN $1
                 ELSE child_name
             END,
             updated_at = CASE
                 WHEN lead_id = $4 OR NULLIF(child_name, '') IS NULL THEN NOW()
                 ELSE updated_at
             END
         WHERE id = $2
           AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $3
         RETURNING *`,
        [firstChildName || null, customerId, normalizedBusinessContext, leadId]
    );
    const nextCustomer = updated.rows[0] || customer;
    nextCustomer.children = buildCustomerChildrenProjection(nextCustomer, savedChildren);
    return { customer: nextCustomer, children: savedChildren };
}

function buildLeadCustomerNotes(lead = {}) {
    const inbound = buildLeadInboundMetadata(lead);
    const utmText = inbound.utm && Object.keys(inbound.utm).length
        ? Object.entries(inbound.utm).map(([key, value]) => `${key}=${value}`).join(', ')
        : null;
    const desiredDateParts = [
        normalizeDateOnly(lead.event_date) || cleanText(lead.event_date),
        inbound.bookingTime
    ].filter(Boolean);
    const lines = [
        `Лід #${lead.id}`,
        lead.source || lead.source_channel ? `Джерело: ${[lead.source, lead.source_channel].filter(Boolean).join(' / ')}` : null,
        inbound.externalId ? `External ID: ${inbound.externalId}` : null,
        inbound.inquiryId ? `Inquiry ID: ${inbound.inquiryId}` : null,
        inbound.email ? `Email: ${inbound.email}` : null,
        inbound.page ? `Сторінка: ${inbound.page}` : null,
        inbound.topic ? `Запит: ${inbound.topic}` : null,
        inbound.message ? `Повідомлення: ${inbound.message}` : null,
        inbound.sessionType ? `Тип сесії: ${inbound.sessionType}` : null,
        desiredDateParts.length ? `Бажана дата/час: ${desiredDateParts.join(' ')}` : null,
        lead.children_count ? `Кількість дітей: ${lead.children_count}` : null,
        lead.child_age ? `Вік дитини: ${lead.child_age}` : null,
        inbound.contactChannels?.length ? `Канали контакту: ${inbound.contactChannels.join(', ')}` : null,
        utmText ? `UTM: ${utmText}` : null,
        lead.notes ? `Нотатки ліда: ${lead.notes}` : null
    ];
    return lines.filter(Boolean).join('\n');
}

function buildLegacyCustomerCardNotes(leadId, card = {}) {
    const marker = `legacy customer_card:${card.id || leadId}`;
    const lines = [
        `[${marker}]`,
        card.event_type ? `Тип події: ${card.event_type}` : null,
        card.event_date ? `Дата події: ${normalizeDateOnly(card.event_date) || cleanText(card.event_date)}` : null,
        card.guest_count ? `Гостей: ${card.guest_count}` : null,
        card.children_count ? `Дітей: ${card.children_count}` : null,
        card.budget_approx ? `Бюджет: ${card.budget_approx}` : null,
        card.how_found ? `Звідки дізнались: ${card.how_found}` : null,
        card.email ? `Email: ${card.email}` : null,
        card.channel ? `Канал: ${card.channel}` : null,
        card.notes ? `Нотатки старої картки: ${card.notes}` : null
    ].filter(Boolean);
    return { marker, text: lines.length > 1 ? lines.join('\n') : '' };
}

function appendUniqueMarkedNote(existingValue, marker, noteValue) {
    const existing = cleanText(existingValue);
    const note = cleanText(noteValue);
    if (!note) return existing || null;
    if (existing && marker && existing.includes(marker)) return existing;
    if (!existing) return note;
    return `${existing}\n\n${note}`;
}

function upsertMarkedNote(existingValue, marker, noteValue) {
    const existing = cleanText(existingValue);
    const note = cleanText(noteValue);
    if (!note) return existing || null;
    if (!existing || !marker || !existing.includes(marker)) return appendUniqueMarkedNote(existing, marker, note);
    const parts = existing.split(/\n{2,}/);
    const index = parts.findIndex(part => part.includes(marker));
    if (index === -1) return appendUniqueMarkedNote(existing, marker, note);
    parts[index] = note;
    return parts.map(cleanText).filter(Boolean).join('\n\n') || null;
}

function appendUniqueLeadCustomerNote(existingValue, noteValue, leadId) {
    const existing = cleanText(existingValue);
    const note = cleanText(noteValue);
    if (!note) return existing || null;
    if (!existing) return note;
    if (leadId && existing.includes(`Лід #${leadId}`)) return existing;
    if (existing.includes(note)) return existing;
    return `${existing}\n${note}`;
}

async function linkLeadCustomer(queryable, {
    businessContext = DEFAULT_BUSINESS_CONTEXT,
    leadId,
    customerId,
    linkType = 'customer_card',
    source = 'lead_customer_flow',
    userId = null,
    metadata = {}
} = {}) {
    const normalizedLeadId = parseInt(leadId, 10);
    const normalizedCustomerId = parseInt(customerId, 10);
    if (!Number.isInteger(normalizedLeadId) || normalizedLeadId <= 0 || !Number.isInteger(normalizedCustomerId) || normalizedCustomerId <= 0) {
        return null;
    }
    const normalizedBusinessContext = normalizeBusinessContext(businessContext) || DEFAULT_BUSINESS_CONTEXT;
    const result = await queryable.query(
        `INSERT INTO lead_customer_links (business_context, lead_id, customer_id, link_type, source, metadata, created_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, NOW())
         ON CONFLICT (business_context, lead_id, customer_id, link_type) DO UPDATE SET
             source = COALESCE(EXCLUDED.source, lead_customer_links.source),
             metadata = COALESCE(lead_customer_links.metadata, '{}'::jsonb) || COALESCE(EXCLUDED.metadata, '{}'::jsonb),
             created_by = COALESCE(lead_customer_links.created_by, EXCLUDED.created_by),
             updated_at = NOW()
         RETURNING *`,
        [
            normalizedBusinessContext,
            normalizedLeadId,
            normalizedCustomerId,
            linkType,
            source,
            JSON.stringify(metadata || {}),
            userId || null
        ]
    );
    return result.rows[0] || null;
}

function customerMatchesBusinessContext(customer, businessContext = DEFAULT_BUSINESS_CONTEXT) {
    if (!customer) return false;
    const expected = normalizeBusinessContext(businessContext) || DEFAULT_BUSINESS_CONTEXT;
    const actual = normalizeBusinessContext(customer.business_context ?? customer.businessContext ?? DEFAULT_BUSINESS_CONTEXT);
    return actual === expected;
}

async function findCustomerForLead(queryable, lead = {}, businessContext = DEFAULT_BUSINESS_CONTEXT) {
    const leadId = parseInt(lead.id, 10);
    if (Number.isInteger(leadId) && leadId > 0) {
        const linkResult = await queryable.query(
            `SELECT c.*
             FROM lead_customer_links lcl
             JOIN customers c ON c.id = lcl.customer_id
             WHERE lcl.lead_id = $1
               AND COALESCE(lcl.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2
               AND COALESCE(c.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2
             ORDER BY lcl.updated_at DESC NULLS LAST, lcl.id DESC
             LIMIT 1`,
            [leadId, businessContext]
        );
        if (linkResult.rows.length && customerMatchesBusinessContext(linkResult.rows[0], businessContext)) {
            return linkResult.rows[0];
        }

        const linked = await queryable.query(
            `SELECT *
             FROM customers
             WHERE lead_id = $1
               AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2
             ORDER BY updated_at DESC NULLS LAST, id DESC
             LIMIT 1`,
            [leadId, businessContext]
        );
        if (linked.rows.length && customerMatchesBusinessContext(linked.rows[0], businessContext)) {
            return linked.rows[0];
        }
    }

    const phoneDigits = normalizeDigits(lead.phone);
    const instagram = normalizeInstagram(lead.instagram);
    if (!phoneDigits && !instagram) return null;

    const matched = await queryable.query(
        `SELECT *
         FROM customers
         WHERE COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $1
           AND (
             ($2 <> '' AND regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = $2)
             OR ($3 <> '' AND lower(regexp_replace(COALESCE(instagram, ''), '^@+', '', 'g')) = $3)
           )
         ORDER BY
           CASE
             WHEN lead_id = $4 THEN 0
             WHEN lead_id IS NULL THEN 1
             ELSE 2
           END,
           updated_at DESC NULLS LAST,
           id DESC
         LIMIT 1`,
        [businessContext, phoneDigits || '', instagram || '', Number.isInteger(leadId) ? leadId : null]
    );
    return matched.rows.length && customerMatchesBusinessContext(matched.rows[0], businessContext)
        ? matched.rows[0]
        : null;
}

async function findDurablyLinkedCustomerForLead(queryable, lead = {}, businessContext = DEFAULT_BUSINESS_CONTEXT) {
    const leadId = parseInt(lead.id, 10);
    if (!Number.isInteger(leadId) || leadId <= 0) return null;

    const normalizedBusinessContext = normalizeBusinessContext(businessContext) || DEFAULT_BUSINESS_CONTEXT;
    const linkResult = await queryable.query(
        `SELECT c.*
         FROM lead_customer_links lcl
         JOIN customers c ON c.id = lcl.customer_id
         WHERE lcl.lead_id = $1
           AND COALESCE(lcl.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2
           AND COALESCE(c.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2
         ORDER BY lcl.updated_at DESC NULLS LAST, lcl.id DESC
         LIMIT 1`,
        [leadId, normalizedBusinessContext]
    );
    if (linkResult.rows.length) return linkResult.rows[0];

    const linked = await queryable.query(
        `SELECT *
         FROM customers
         WHERE lead_id = $1
           AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2
         ORDER BY updated_at DESC NULLS LAST, id DESC
         LIMIT 1`,
        [leadId, normalizedBusinessContext]
    );
    return linked.rows[0] || null;
}

async function ensureDealCustomerForLead(queryable, lead = {}, businessContext = DEFAULT_BUSINESS_CONTEXT, options = {}) {
    const leadId = parseInt(lead.id, 10);
    if (!Number.isInteger(leadId) || leadId <= 0) return null;

    const normalizedBusinessContext = normalizeBusinessContext(businessContext) || DEFAULT_BUSINESS_CONTEXT;
    const existing = await findCustomerForLead(queryable, lead, normalizedBusinessContext);
    const name = leadCustomerName(lead);
    const phone = cleanText(lead.phone);
    const instagram = normalizeInstagram(lead.instagram);
    const childName = leadCustomerChildName(lead);
    const source = leadCustomerSource(lead);
    const noteBlock = buildLeadCustomerNotes(lead);

    if (existing) {
        const notes = appendUniqueLeadCustomerNote(existing.notes, noteBlock, leadId);
        const updated = await queryable.query(
            `UPDATE customers
             SET name = COALESCE(NULLIF(name, ''), $1),
                 phone = COALESCE(NULLIF(phone, ''), $2),
                 instagram = COALESCE(NULLIF(instagram, ''), $3),
                 child_name = COALESCE(NULLIF(child_name, ''), $4),
                 source = COALESCE(NULLIF(source, ''), $5),
                 notes = $6,
                 lead_id = CASE WHEN lead_id IS NULL OR lead_id = $7 THEN $7 ELSE lead_id END,
                 social_identities = $8::jsonb,
                 updated_at = NOW()
             WHERE id = $9
               AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $10
             RETURNING *`,
            [
                name,
                phone || null,
                instagram || null,
                childName || null,
                source,
                notes,
                leadId,
                JSON.stringify(mergeLeadSocialIdentities(existing.social_identities, lead)),
                existing.id,
                normalizedBusinessContext
            ]
        );
        let customer = updated.rows[0];
        const link = await linkLeadCustomer(queryable, {
            businessContext: normalizedBusinessContext,
            leadId,
            customerId: customer?.id,
            linkType: options.linkType || 'deal_customer',
            source: options.source || 'deal_stage',
            userId: options.userId || null,
            metadata: { mode: existing.lead_id ? 'updated_existing' : 'linked_existing' }
        });
        const childSync = await syncLeadCelebrantsToCustomerChildren(queryable, lead, customer, normalizedBusinessContext);
        customer = childSync.customer || customer;
        return {
            mode: existing.lead_id ? 'updated_existing' : 'linked_existing',
            customer,
            link,
            children: childSync.children
        };
    }

    const inserted = await queryable.query(
        `INSERT INTO customers (business_context, name, phone, instagram, child_name, source, notes, lead_id, social_identities)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
         RETURNING *`,
        [
            normalizedBusinessContext,
            name,
            phone || null,
            instagram || null,
            childName || null,
            source,
            noteBlock || null,
            leadId,
            JSON.stringify(leadSocialIdentities(lead))
        ]
    );
    let customer = inserted.rows[0];
    const link = await linkLeadCustomer(queryable, {
        businessContext: normalizedBusinessContext,
        leadId,
        customerId: customer?.id,
        linkType: options.linkType || 'deal_customer',
        source: options.source || 'deal_stage',
        userId: options.userId || null,
        metadata: { mode: 'created_new' }
    });
    const childSync = await syncLeadCelebrantsToCustomerChildren(queryable, lead, customer, normalizedBusinessContext);
    customer = childSync.customer || customer;
    return {
        mode: 'created_new',
        customer,
        link,
        children: childSync.children
    };
}

function calculateDaysUntil(dateValue) {
    const dateOnly = toDateOnly(dateValue);
    if (!dateOnly) return null;
    const target = new Date(`${dateOnly}T00:00:00`);
    if (Number.isNaN(target.getTime())) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((target - today) / 86400000);
}

async function optionalWorkspaceQuery(sql, params = []) {
    try {
        return await pool.query(sql, params);
    } catch (err) {
        if (OPTIONAL_WORKSPACE_ERROR_CODES.has(err.code)) {
            log.warn(`Workspace optional query skipped: ${err.message}`);
            return { rows: [] };
        }
        throw err;
    }
}

function mapWorkspaceLead(row) {
    const stage = row.pipeline_stage || 'new';
    const inbound = buildLeadInboundMetadata(row);
    return {
        id: row.id,
        businessContext: row.business_context || DEFAULT_BUSINESS_CONTEXT,
        clientName: row.client_name,
        phone: row.phone,
        instagram: row.instagram,
        source: row.source,
        sourceChannel: row.source_channel,
        externalId: inbound.externalId || null,
        eventType: inbound.eventType || null,
        eventId: inbound.eventId || null,
        bookingId: inbound.bookingId || null,
        inquiryId: inbound.inquiryId || null,
        email: inbound.email || null,
        page: inbound.page || null,
        topic: inbound.topic || null,
        message: inbound.message || null,
        sessionType: inbound.sessionType || null,
        bookingTime: inbound.bookingTime || null,
        contactChannels: inbound.contactChannels,
        utm: inbound.utm,
        inbound,
        notes: row.notes,
        status: row.status || STAGE_TO_STATUS[stage] || 'new',
        pipelineStage: stage,
        assignedTo: row.assigned_to,
        assignedName: row.assigned_name || row.assigned_username || null,
        leadType: row.lead_type,
        qualityCategory: row.quality_category,
        eventDate: row.event_date,
        childrenCount: row.children_count,
        childAge: row.child_age,
        celebrants: normalizeCelebrants(row.celebrants, {
            childrenCount: row.children_count,
            childAge: row.child_age
        }),
        programId: row.program_id,
        programName: row.program_name || row.program_full_name || null,
        bookingId: row.booking_id || inbound.bookingId || null,
        lostReason: row.lost_reason,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        lastContactAt: row.last_contact_at
    };
}

function mapWorkspaceCustomer(row) {
    if (!row) return null;
    const customer = {
        id: row.id,
        businessContext: row.business_context || DEFAULT_BUSINESS_CONTEXT,
        name: row.name,
        phone: row.phone,
        instagram: row.instagram,
        socialIdentities: parseJsonArray(row.social_identities),
        childName: row.child_name,
        childBirthday: row.child_birthday,
        source: row.source,
        notes: row.notes,
        leadId: row.lead_id || null,
        totalBookings: parseInt(row.real_total_bookings ?? row.total_bookings ?? 0, 10) || 0,
        totalSpent: parseInt(row.real_total_spent ?? row.total_spent ?? 0, 10) || 0,
        firstVisit: row.real_first_visit || row.first_visit || null,
        lastVisit: row.real_last_visit || row.last_visit || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
    if (Array.isArray(row.children)) customer.children = row.children;
    return customer;
}

function buildCustomerCardCompat(lead = {}, customer = null) {
    if (!lead && !customer) return null;
    return {
        deprecated: true,
        source: 'customers',
        lead_id: lead?.id || customer?.lead_id || null,
        customer_id: customer?.id || null,
        name: customer?.name || lead?.client_name || lead?.clientName || null,
        phone: customer?.phone || lead?.phone || null,
        instagram: customer?.instagram || lead?.instagram || null,
        email: null,
        channel: lead?.source_channel || lead?.sourceChannel || lead?.source || null,
        event_type: lead?.quality_category || lead?.qualityCategory || lead?.event_type || null,
        event_date: lead?.event_date || lead?.eventDate || null,
        guest_count: null,
        children_count: lead?.children_count || lead?.childrenCount || null,
        budget_approx: lead?.potential_value ?? lead?.potentialValue ?? lead?.budget_approx ?? null,
        how_found: lead?.source || null,
        notes: customer?.notes || lead?.notes || null
    };
}

function mapWorkspaceBooking(row, leadBookingId = null) {
    const isLeadBooking = Boolean(leadBookingId) && String(row.id) === String(leadBookingId);
    return {
        id: row.id,
        date: row.date,
        time: row.time,
        status: row.status,
        programName: row.program_name || row.label || row.program_code || null,
        category: row.category,
        price: row.price,
        room: row.room,
        kidsCount: row.kids_count,
        banquetGuests: row.banquet_guests,
        banquetAdults: row.banquet_adults,
        banquetTables: row.banquet_tables,
        banquetMenu: row.banquet_menu,
        customerId: row.customer_id,
        notes: row.notes,
        isLeadBooking,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

function mapWorkspaceTask(row, leadId = null, exactBookingIds = []) {
    const sourceType = row.source_type;
    const sourceId = row.source_id;
    const exactBookingSet = new Set((exactBookingIds || []).map(id => String(id)));
    const isExactLeadTask = sourceType === 'lead' && String(sourceId || '') === String(leadId || '');
    const isExactBookingTask = sourceType === 'booking' && exactBookingSet.has(String(sourceId || ''));
    return {
        id: row.id,
        title: row.title,
        description: row.description,
        status: row.status,
        priority: row.priority,
        assignedTo: row.assigned_to,
        owner: row.owner,
        date: row.date,
        deadline: row.deadline,
        category: row.category,
        taskType: row.task_type,
        sourceType,
        sourceId,
        isExactCaseTask: Boolean(isExactLeadTask || isExactBookingTask),
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

const FB_PAGE_ACCESS_TOKEN    = process.env.FB_PAGE_ACCESS_TOKEN    || '';
const VIBER_AUTH_TOKEN        = process.env.VIBER_AUTH_TOKEN        || '';

// POST /api/leads/landing — public endpoint for landing page form (no auth required)
router.post('/landing', async (req, res) => {
    try {
        const businessContext = publicBusinessContext(req);
        const { name, phone, package: pkg } = req.body;
        if (!name && !phone) {
            return res.status(400).json({ success: false, error: 'Ім\'я або телефон обов\'язкові' });
        }
        const notes = pkg ? `Пакет: ${pkg}` : 'Заявка з лендінгу';
        const result = await pool.query(`
            INSERT INTO leads (business_context, client_name, phone, source, notes, status)
            VALUES ($1, $2, $3, 'landing', $4, 'new')
            RETURNING id, business_context, client_name, phone, source, status, created_at
        `, [businessContext, name || 'Невідомий', phone || null, notes]);

        const lead = result.rows[0];
        log.info(`Landing lead created: ${lead.client_name} (${lead.phone})`);

        // Notify via lead notifier if available
        try {
            if (typeof notifyNewLead === 'function') {
                await notifyNewLead(lead);
            }
        } catch (e) { /* non-blocking */ }

        res.json({ success: true, lead: { id: lead.id } });
    } catch (err) {
        log.error('POST /leads/landing error', err);
        res.status(500).json({ success: false, error: 'Помилка збереження заявки' });
    }
});

// Public provider-secret guarded webhook for external CRM/bot lead capture.
router.post('/webhook/universal', handleUniversalWebhook);

// Public provider-secret guarded webhook for Maysternya Doli bot timeline bookings.
router.post('/webhook/maysternya-booking', handleMaysternyaBookingWebhook);

// Public provider-secret guarded availability check for Maysternya Doli bot booking slots.
router.post('/webhook/maysternya-availability', handleMaysternyaAvailabilityWebhook);

// GET /api/leads/webhook/status — public read-only webhook configuration status.
router.get('/webhook/status', (req, res) => {
    res.json({
        success: true,
        webhooks: {
            telegram:  { configured: true, note: 'Built into /api/telegram/webhook (private chats)' },
            facebook:  { configured: !!FB_PAGE_ACCESS_TOKEN, endpoint: '/api/leads/webhook/facebook'  },
            instagram: { configured: !!FB_PAGE_ACCESS_TOKEN, endpoint: '/api/leads/webhook/instagram' },
            viber:     { configured: !!VIBER_AUTH_TOKEN,     endpoint: '/api/leads/webhook/viber'     },
            universal: {
                configured: !!UNIVERSAL_WEBHOOK_TOKEN,
                endpoint:   '/api/leads/webhook/universal?source=<name>',
                sources:    ['maysternya_bot', 'maysternya_site', 'tiktok', 'turbo', 'bnderoga', 'custom'],
                dryRun:     'Add ?dryRun=true or header X-CRM-Dry-Run: true to validate without writing a lead.',
            },
            maysternyaBooking: {
                configured: !!UNIVERSAL_WEBHOOK_TOKEN,
                endpoint: '/api/leads/webhook/maysternya-booking',
                businessContext: 'maysternya_doli',
                dryRun: 'Add ?dryRun=true or header X-CRM-Dry-Run: true to validate without creating a booking.',
            },
            maysternyaAvailability: {
                configured: !!UNIVERSAL_WEBHOOK_TOKEN,
                endpoint: '/api/leads/webhook/maysternya-availability',
                businessContext: 'maysternya_doli',
                payload: 'date_from, date_to, duration, resource_id/resource_name, timezone, business_context',
            }
        }
    });
});

// All remaining leads routes require authentication.
router.use(authenticateToken);
router.use(requireRole('manager', 'marketer'));

// GET /api/leads/assignees — active users that can own leads
router.get('/assignees', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, username, name, role
             FROM users
             WHERE is_active = true
               AND role = ANY($1::text[])
             ORDER BY
               CASE role
                 WHEN 'creator' THEN 1
                 WHEN 'director' THEN 2
                 WHEN 'vice_director' THEN 3
                 WHEN 'senior_manager' THEN 4
                 WHEN 'manager' THEN 5
                 WHEN 'marketer' THEN 6
                 WHEN 'admin' THEN 7
                 ELSE 99
               END,
               COALESCE(NULLIF(name, ''), username)`,
            [LEAD_ASSIGNEE_ROLES]
        );
        res.json({ success: true, users: result.rows });
    } catch (err) {
        log.error('GET /leads/assignees error', err);
        res.status(500).json({ success: false, error: 'Помилка завантаження відповідальних' });
    }
});

// GET /api/leads — list all leads with optional filters
router.get('/', async (req, res) => {
    try {
        const businessScope = ensureBusinessScope(req, res);
        if (!businessScope) return;
        const result = await fetchLeadList({ businessScope, query: req.query });
        if (result.error) {
            return res.status(400).json({ success: false, error: result.error });
        }
        res.json({ success: true, leads: result.leads, pagination: result.pagination });
    } catch (err) {
        log.error('GET /leads error', err);
        res.status(500).json({ success: false, error: 'Помилка завантаження лідів' });
    }
});

// GET /api/leads/hot — leads that need attention (24h+ since creation, still 'new')
router.get('/hot', async (req, res) => {
    try {
        const businessScope = ensureBusinessScope(req, res);
        if (!businessScope) return;
        const params = [];
        const scopeSql = leadScopeCondition(params, businessScope, 'l');
        const result = await pool.query(`
            SELECT l.*, u.name AS assigned_name, p.label AS program_name,
                   EXTRACT(EPOCH FROM (NOW() - l.created_at)) / 3600 AS hours_waiting
            FROM leads l
            LEFT JOIN users u ON l.assigned_to = u.id
            LEFT JOIN products p ON l.program_id = p.id
            WHERE COALESCE(l.pipeline_stage, 'new') = 'new'
              AND COALESCE(l.lead_type, 'quality') = 'quality'
              AND ${scopeSql}
              AND l.created_at < NOW() - INTERVAL '24 hours'
            ORDER BY l.created_at ASC
            LIMIT 50
        `, params);
        res.json({ success: true, leads: result.rows });
    } catch (err) {
        log.error('GET /leads/hot error', err);
        res.status(500).json({ success: false, error: 'Помилка' });
    }
});

// GET /api/leads/stats — funnel statistics (by status + type + pipeline)
router.get('/stats', async (req, res) => {
    try {
        const businessScope = ensureBusinessScope(req, res);
        if (!businessScope) return;
        const { period } = req.query; // today, week, month, all
        let dateFilter = '';
        if (period === 'today') dateFilter = "AND created_at >= CURRENT_DATE";
        else if (period === 'week') dateFilter = "AND created_at >= CURRENT_DATE - INTERVAL '7 days'";
        else if (period === 'month') dateFilter = "AND created_at >= CURRENT_DATE - INTERVAL '30 days'";
        const allStatusParams = [];
        const typeParams = [];
        const allStageParams = [];
        const salesStatusParams = [];
        const salesStageParams = [];
        const allStatusScopeSql = leadScopeCondition(allStatusParams, businessScope, '');
        const typeScopeSql = leadScopeCondition(typeParams, businessScope, '');
        const allStageScopeSql = leadScopeCondition(allStageParams, businessScope, '');
        const salesStatusScopeSql = leadScopeCondition(salesStatusParams, businessScope, '');
        const salesStageScopeSql = leadScopeCondition(salesStageParams, businessScope, '');

        const [byStatusAll, byType, byStageAll, byStatusSales, byStageSales] = await Promise.all([
            pool.query(`SELECT ${LEAD_STATUS_FROM_STAGE_SQL} AS status, COUNT(*) AS count FROM leads WHERE ${allStatusScopeSql} ${dateFilter} GROUP BY ${LEAD_STATUS_FROM_STAGE_SQL}`, allStatusParams),
            pool.query(`SELECT COALESCE(NULLIF(lead_type, ''), 'quality') AS lead_type, COUNT(*) AS count FROM leads WHERE ${typeScopeSql} ${dateFilter} GROUP BY COALESCE(NULLIF(lead_type, ''), 'quality')`, typeParams),
            pool.query(`SELECT COALESCE(NULLIF(pipeline_stage, ''), 'new') AS pipeline_stage, COUNT(*) AS count FROM leads WHERE ${allStageScopeSql} ${dateFilter} GROUP BY COALESCE(NULLIF(pipeline_stage, ''), 'new')`, allStageParams),
            pool.query(`SELECT ${LEAD_STATUS_FROM_STAGE_SQL} AS status, COUNT(*) AS count FROM leads WHERE ${salesStatusScopeSql} ${dateFilter} AND COALESCE(lead_type, 'quality') = 'quality' GROUP BY ${LEAD_STATUS_FROM_STAGE_SQL}`, salesStatusParams),
            pool.query(`SELECT COALESCE(NULLIF(pipeline_stage, ''), 'new') AS pipeline_stage, COUNT(*) AS count FROM leads WHERE ${salesStageScopeSql} ${dateFilter} AND COALESCE(lead_type, 'quality') = 'quality' GROUP BY COALESCE(NULLIF(pipeline_stage, ''), 'new')`, salesStageParams),
        ]);

        const allStats = emptyStatusStats();
        for (const r of byStatusAll.rows) allStats[r.status] = parseInt(r.count, 10) || 0;
        const allTotal = Object.values(allStats).reduce((s, v) => s + v, 0);

        const typeStats = emptyLeadTypeStats();
        for (const r of byType.rows) {
            const type = VALID_LEAD_TYPES.has(r.lead_type) ? r.lead_type : SALES_LEAD_TYPE;
            typeStats[type] = parseInt(r.count, 10) || 0;
        }

        const allStageStats = emptyStageStats();
        for (const r of byStageAll.rows) {
            const stage = VALID_PIPELINE_STAGES.has(r.pipeline_stage) ? r.pipeline_stage : 'new';
            allStageStats[stage] = parseInt(r.count, 10) || 0;
        }

        const salesStats = emptyStatusStats();
        for (const r of byStatusSales.rows) salesStats[r.status] = parseInt(r.count, 10) || 0;
        const salesTotal = Object.values(salesStats).reduce((s, v) => s + v, 0);

        const salesStageStats = emptyStageStats();
        for (const r of byStageSales.rows) {
            const stage = VALID_PIPELINE_STAGES.has(r.pipeline_stage) ? r.pipeline_stage : 'new';
            salesStageStats[stage] = parseInt(r.count, 10) || 0;
        }

        const operationalQueueStats = Object.fromEntries(NON_SALES_LEAD_TYPES.map(type => [type, typeStats[type] || 0]));

        res.json({
            success: true,
            stats: salesStats,
            typeStats,
            stageStats: salesStageStats,
            total: salesTotal,
            salesStats,
            salesStageStats,
            salesTotal,
            classificationStats: typeStats,
            operationalQueueStats,
            allStats,
            allStageStats,
            allTotal,
            meta: {
                salesLeadType: SALES_LEAD_TYPE,
                excludedLeadTypes: NON_SALES_LEAD_TYPES
            }
        });
    } catch (err) {
        log.error('GET /leads/stats error', err);
        res.status(500).json({ success: false, error: 'Помилка' });
    }
});

// POST /api/leads — create new lead
router.post('/', async (req, res) => {
    try {
        const businessContext = ensureBusinessContext(req, res);
        if (!businessContext) return;
        const { client_name, phone, telegram_id, instagram, source, program_id, event_date, children_count, child_age, notes, assigned_to, celebrants } = req.body;
        if (!client_name) {
            return res.status(400).json({ success: false, error: "Ім'я клієнта обов'язкове" });
        }
        const assignedTo = parseOptionalPositiveInt(assigned_to, 'assigned_to');
        if (assignedTo.error) {
            return res.status(400).json({ success: false, error: assignedTo.error });
        }
        if (assignedTo.provided && !(await ensureAssignableUser(assignedTo.value))) {
            return res.status(400).json({ success: false, error: 'Відповідального не знайдено або він неактивний' });
        }
        const normalizedCelebrants = normalizeCelebrants(celebrants);
        const result = await pool.query(`
            INSERT INTO leads (business_context, client_name, phone, telegram_id, instagram, source, program_id, event_date, children_count, child_age, notes, assigned_to, celebrants)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
            RETURNING *
        `, [businessContext, client_name, phone || null, telegram_id || null, instagram || null, source || null,
            program_id || null, event_date || null,
            children_count || null, child_age || null, notes || null,
            assignedTo.provided ? assignedTo.value : null,
            JSON.stringify(normalizedCelebrants)]);

        log.info(`Lead created: ${client_name} by ${req.user.username}`);
        res.json({ success: true, lead: result.rows[0] });
    } catch (err) {
        log.error('POST /leads error', err);
        res.status(500).json({ success: false, error: 'Помилка створення ліду' });
    }
});

// PATCH /api/leads/:id — update lead
router.patch('/:id', async (req, res) => {
    try {
        const businessContext = ensureBusinessContext(req, res);
        if (!businessContext) return;
        const leadId = parseInt(req.params.id, 10);
        const { status, notes, assigned_to, last_contact_at, booking_id, lost_reason, client_name, phone, instagram, source, source_channel, event_date, children_count, child_age, celebrants, program_id, pipeline_stage, milestone_tags, lead_type, quality_category, potential_value } = req.body;
        const kanbanOrderIds = normalizeKanbanOrder(req.body?.kanban_order, leadId);
        const collaborationTaskHandled = [
            req.body?.collaboration_task_created,
            req.body?.collaborationTaskCreated,
            req.body?.skip_collaboration_task_auto_create,
            req.body?.skipCollaborationTaskAutoCreate
        ].some(truthyWebhookValue);
        const updates = [];
        const params = [];
        const assignedTo = parseOptionalPositiveInt(assigned_to, 'assigned_to');
        const potentialValue = parseOptionalNonNegativeInt(potential_value, 'potential_value');
        const leadTypePatch = lead_type !== undefined ? normalizeLeadType(lead_type) : { value: undefined };
        const leadTypeRule = leadTypePatch.value ? leadTypeWorkflowRule(leadTypePatch.value) : null;
        const stageStatus = normalizeLeadPatchStageStatus({
            pipelineStage: leadTypeRule?.pipelineStage || pipeline_stage,
            status: leadTypeRule?.pipelineStage ? undefined : status
        });

        if (assignedTo.error) {
            return res.status(400).json({ success: false, error: assignedTo.error });
        }
        if (potentialValue.error) {
            return res.status(400).json({ success: false, error: potentialValue.error });
        }
        if (leadTypePatch.error) {
            return res.status(400).json({ success: false, error: leadTypePatch.error });
        }
        if (stageStatus.error) {
            return res.status(400).json({ success: false, error: stageStatus.error });
        }
        if (assignedTo.provided && !(await ensureAssignableUser(assignedTo.value))) {
            return res.status(400).json({ success: false, error: 'Відповідального не знайдено або він неактивний' });
        }

        if (stageStatus.stageProvided) {
            params.push(stageStatus.stage);
            updates.push(`pipeline_stage = $${params.length}`);
            params.push(stageStatus.status);
            updates.push(`status = $${params.length}`);
            if (stageStatus.status === 'booked') updates.push(`booked_at = COALESCE(booked_at, NOW())`);
        }
        if (notes !== undefined) { params.push(notes); updates.push(`notes = $${params.length}`); }
        if (assignedTo.provided) { params.push(assignedTo.value); updates.push(`assigned_to = $${params.length}`); }
        if (booking_id !== undefined) { params.push(booking_id); updates.push(`booking_id = $${params.length}`); }
        if (lost_reason !== undefined) { params.push(lost_reason); updates.push(`lost_reason = $${params.length}`); }
        else if (leadTypeRule?.lostReason) { params.push(leadTypeRule.lostReason); updates.push(`lost_reason = $${params.length}`); }
        if (client_name !== undefined) { params.push(client_name); updates.push(`client_name = $${params.length}`); }
        if (phone !== undefined) { params.push(phone); updates.push(`phone = $${params.length}`); }
        if (instagram !== undefined) { params.push(instagram); updates.push(`instagram = $${params.length}`); }
        if (source !== undefined) { params.push(source); updates.push(`source = $${params.length}`); }
        if (event_date !== undefined) { params.push(event_date || null); updates.push(`event_date = $${params.length}`); }
        if (children_count !== undefined) { params.push(children_count); updates.push(`children_count = $${params.length}`); }
        if (child_age !== undefined) { params.push(child_age); updates.push(`child_age = $${params.length}`); }
        if (celebrants !== undefined) {
            params.push(JSON.stringify(normalizeCelebrants(celebrants)));
            updates.push(`celebrants = $${params.length}::jsonb`);
        }
        if (program_id !== undefined) { params.push(program_id || null); updates.push(`program_id = $${params.length}`); }
        if (milestone_tags !== undefined) { params.push(milestone_tags); updates.push(`milestone_tags = $${params.length}`); }
        if (lead_type !== undefined) { params.push(leadTypePatch.value); updates.push(`lead_type = $${params.length}`); }
        if (quality_category !== undefined) { params.push(quality_category || null); updates.push(`quality_category = $${params.length}`); }
        if (source_channel !== undefined) { params.push(source_channel || null); updates.push(`source_channel = $${params.length}`); }
        if (potentialValue.provided) { params.push(potentialValue.value); updates.push(`potential_value = $${params.length}`); }
        if (last_contact_at) {
            params.push(last_contact_at);
            updates.push(`last_contact_at = $${params.length}`);
        } else if (stageStatus.status === 'contact') {
            updates.push(`last_contact_at = COALESCE(last_contact_at, NOW())`);
        }

        if (updates.length === 0) {
            return res.status(400).json({ success: false, error: 'Немає полів для оновлення' });
        }

        params.push(leadId);
        params.push(businessContext);
        let updatedLead;
        let dealCustomerLink = null;
        let previousLead = null;
        let stageTransition = null;
        const effectivePipelineStage = stageStatus.stageProvided ? stageStatus.stage : undefined;
        const shouldEnsureCustomerCard = CUSTOMER_CARD_PIPELINE_STAGES.has(effectivePipelineStage);
        const shouldSyncLinkedCustomerChildren = celebrants !== undefined && !shouldEnsureCustomerCard;
        const updateClient = shouldEnsureCustomerCard || shouldSyncLinkedCustomerChildren || stageStatus.stageProvided || kanbanOrderIds.length ? await pool.connect() : null;
        try {
            if (updateClient) await updateClient.query('BEGIN');
            const queryable = updateClient || pool;
            if (stageStatus.stageProvided) {
                const previousResult = await queryable.query(
                    `SELECT id, pipeline_stage, status
                     FROM leads
                     WHERE id = $1
                       AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2
                     FOR UPDATE`,
                    [leadId, businessContext]
                );
                if (previousResult.rows.length === 0) {
                    if (updateClient) await updateClient.query('ROLLBACK');
                    return res.status(404).json({ success: false, error: 'Lead not found' });
                }
                previousLead = previousResult.rows[0];
            }
            const result = await queryable.query(
                `UPDATE leads SET ${updates.join(', ')}
                 WHERE id = $${params.length - 1}
                   AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $${params.length}
                 RETURNING *`,
                params
            );
            if (result.rows.length === 0) {
                if (updateClient) await updateClient.query('ROLLBACK');
                return res.status(404).json({ success: false, error: 'Лід не знайдено' });
            }

            updatedLead = result.rows[0];
            if (stageStatus.stageProvided) {
                const oldStage = previousLead?.pipeline_stage || 'new';
                const newStage = updatedLead.pipeline_stage || effectivePipelineStage || 'new';
                stageTransition = { oldStage, newStage };
                if (oldStage !== newStage) {
                    await logStageChange(queryable, {
                        leadId: updatedLead.id,
                        oldStage,
                        newStage,
                        oldStatus: previousLead?.status || STAGE_TO_STATUS[oldStage] || 'new',
                        newStatus: updatedLead.status || STAGE_TO_STATUS[newStage] || 'new',
                        userId: req.user?.id
                    });
                }
            }
            if (shouldEnsureCustomerCard) {
                dealCustomerLink = await ensureDealCustomerForLead(queryable, updatedLead, businessContext, {
                    userId: req.user?.id,
                    source: 'leads.patch',
                    linkType: 'deal_customer'
                });
            } else if (shouldSyncLinkedCustomerChildren) {
                const linkedCustomer = await findDurablyLinkedCustomerForLead(queryable, updatedLead, businessContext);
                if (linkedCustomer) {
                    const childSync = await syncLeadCelebrantsToCustomerChildren(queryable, updatedLead, linkedCustomer, businessContext);
                    dealCustomerLink = {
                        mode: 'synced_existing_children',
                        customer: childSync.customer || linkedCustomer,
                        link: null,
                        children: childSync.children
                    };
                }
            }
            if (kanbanOrderIds.length) {
                await persistLeadKanbanOrder(queryable, {
                    businessContext,
                    stage: updatedLead.pipeline_stage || effectivePipelineStage || 'new',
                    orderedLeadIds: kanbanOrderIds
                });
                const refreshedLead = await queryable.query(
                    `SELECT * FROM leads
                      WHERE id = $1
                        AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2
                      LIMIT 1`,
                    [leadId, businessContext]
                );
                updatedLead = refreshedLead.rows[0] || updatedLead;
            }
            if (updateClient) await updateClient.query('COMMIT');
        } catch (err) {
            if (updateClient) await updateClient.query('ROLLBACK').catch(() => {});
            throw err;
        } finally {
            if (updateClient) updateClient.release();
        }

        // v33.8.0 Integration 8: Lead → Customer source link
        const newStatus = updatedLead.status;
        const newStage = updatedLead.pipeline_stage || effectivePipelineStage || 'new';
        if ((['deal', 'deposit_received', 'waiting', 'completed', 'closed'].includes(newStage) || ['completed', 'booked'].includes(newStatus)) && updatedLead.booking_id) {
            setImmediate(async () => {
                try {
                    const bk = await pool.query(
                        `SELECT customer_id FROM bookings
                         WHERE id = $1 AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2`,
                        [updatedLead.booking_id, businessContext]
                    );
                    const custId = bk.rows[0]?.customer_id;
                    if (!custId) return;
                    const customerSource = normalizeCustomerSource(updatedLead.source || 'lead', { unknownAsNull: false });
                    await linkLeadCustomer(pool, {
                        businessContext,
                        leadId: updatedLead.id,
                        customerId: custId,
                        linkType: 'booking_customer',
                        source: 'lead_booking_sync',
                        userId: req.user?.id,
                        metadata: { bookingId: updatedLead.booking_id }
                    });
                    await pool.query(
                        `UPDATE customers
                         SET source = COALESCE(NULLIF(source, ''), $1),
                             lead_id = COALESCE(lead_id, $2),
                             notes = CONCAT_WS(E'\n', notes, $3)
                         WHERE id = $4
                           AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $5
                           AND (source IS NULL OR source = '')`,
                        [customerSource, updatedLead.id,
                         `Конвертований з ліду #${updatedLead.id} (${getCustomerSourceLabel(customerSource)})`,
                         custId, businessContext]
                    );
                    const customerResult = await pool.query(
                        `SELECT *
                         FROM customers
                         WHERE id = $1
                           AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2
                         LIMIT 1`,
                        [custId, businessContext]
                    );
                    if (customerResult.rows[0]) {
                        await syncLeadCelebrantsToCustomerChildren(pool, updatedLead, customerResult.rows[0], businessContext);
                    }
                    log.info(`[Lead→Customer] Lead ${updatedLead.id} → customer ${custId}, source: ${updatedLead.source}`);
                } catch (e) { log.warn('[LeadConvert] Error:', e.message); }
            });
        }

        // v29.1: Pipeline stage hooks (fire-and-forget)
        if (newStage === 'deposit_received') {
            onDepositReceived(updatedLead, req.user, {
                businessContext,
                oldStage: stageTransition?.oldStage || null,
                newStage,
                enteredDepositStage: stageTransition?.oldStage !== 'deposit_received'
                    && stageTransition?.newStage === 'deposit_received'
            }).catch(e =>
                log.error('onDepositReceived error (non-blocking)', e)
            );
        }
        if (leadTypePatch.value === 'collaboration' && !collaborationTaskHandled) {
            onCollaborationLead(updatedLead, req.user).catch(e =>
                log.error('onCollaborationLead error (non-blocking)', e)
            );
        }
        // v29.1: Auto-add to mailing on informational/lost, but never for spam.
        if (shouldAddLeadToMailing(updatedLead, newStage)) {
            addToMailingIfNeeded(updatedLead).catch(e =>
                log.error('addToMailing error (non-blocking)', e)
            );
        }
        const response = { success: true, lead: updatedLead };
        if (dealCustomerLink?.customer) {
            response.customer = mapWorkspaceCustomer(dealCustomerLink.customer);
            response.customerLinkMode = dealCustomerLink.mode;
        }
        res.json(response);
    } catch (err) {
        log.error('PATCH /leads/:id error', err);
        res.status(500).json({ success: false, error: 'Помилка оновлення' });
    }
});

// POST /api/leads/:id/collaboration-task — atomic collaboration handoff
router.post('/:id/collaboration-task', async (req, res) => {
    const client = await pool.connect();
    let transactionStarted = false;
    try {
        const businessContext = ensureBusinessContext(req, res);
        if (!businessContext) return;
        const leadId = parseInt(req.params.id, 10);
        if (!Number.isInteger(leadId) || leadId <= 0) {
            return res.status(400).json({ success: false, error: 'Некоректний ID ліда' });
        }

        const ownerId = parseOptionalPositiveInt(req.body?.ownerUserId ?? req.body?.owner_user_id, 'ownerUserId');
        if (ownerId.error) {
            return res.status(400).json({ success: false, error: ownerId.error });
        }
        if (!ownerId.provided || !ownerId.value) {
            return res.status(400).json({ success: false, error: 'Оберіть відповідального для задачі співпраці' });
        }

        const afterCommit = [];
        await client.query('BEGIN');
        transactionStarted = true;

        const leadResult = await client.query(
            `SELECT *
             FROM leads
             WHERE id = $1
               AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2
             FOR UPDATE`,
            [leadId, businessContext]
        );
        if (leadResult.rows.length === 0) {
            await client.query('ROLLBACK');
            transactionStarted = false;
            return res.status(404).json({ success: false, error: 'Лід не знайдено' });
        }

        const oldLead = leadResult.rows[0];
        const owner = await getAssignableTaskOwner(ownerId.value, { actor: req.user, pool: client });
        const taskPayload = buildCollaborationTaskPayload(oldLead, req.body, owner, req.user, businessContext);
        if (taskPayload.error) {
            await client.query('ROLLBACK');
            transactionStarted = false;
            return res.status(400).json({ success: false, error: taskPayload.error });
        }

        const task = await getKleshnya().createTask(taskPayload, { pool: client, afterCommit });
        const updateResult = await client.query(
            `UPDATE leads
                SET lead_type = $1,
                    pipeline_stage = $2,
                    status = $3,
                    last_contact_at = COALESCE(last_contact_at, NOW())
              WHERE id = $4
                AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $5
              RETURNING *`,
            ['collaboration', 'contacted', 'contact', leadId, businessContext]
        );
        if (updateResult.rows.length === 0) {
            const err = new Error('Лід не знайдено під час оновлення');
            err.statusCode = 404;
            throw err;
        }

        const updatedLead = updateResult.rows[0];
        await logCollaborationWorkflow(client, {
            oldLead,
            updatedLead,
            task,
            userId: req.user?.id
        });

        await client.query('COMMIT');
        transactionStarted = false;
        runAfterCommitCallbacks(afterCommit);

        res.json({
            success: true,
            lead: updatedLead,
            task,
            meta: {
                atomic: true,
                taskCreatedBy: 'backend',
                duplicateMode: 'reject',
                source: 'leads.collaboration_task'
            }
        });
    } catch (err) {
        if (transactionStarted) {
            await client.query('ROLLBACK').catch(() => {});
        }
        if (err?.code === 'TASK_DUPLICATE_ACTIVE' || err?.statusCode === 409) {
            return res.status(409).json({
                success: false,
                error: 'duplicate',
                code: 'TASK_DUPLICATE_ACTIVE',
                message: err.message || 'Активна задача для цього ліда вже існує',
                existingId: err.task?.id || null,
                existingStatus: err.task?.status || null
            });
        }
        if (err?.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
            return res.status(err.statusCode).json({
                success: false,
                error: err.message || 'Не вдалося створити задачу співпраці',
                code: err.code || null
            });
        }
        log.error('POST /leads/:id/collaboration-task error', err);
        res.status(500).json({ success: false, error: 'Не вдалося виконати співпрацю атомарно' });
    } finally {
        client.release();
    }
});

// POST /api/leads/:id/link-customer — explicit operator-confirmed lead/customer link
router.post('/:id/link-customer', requireRole('manager'), async (req, res) => {
    const client = await pool.connect();
    try {
        const businessContext = ensureBusinessContext(req, res);
        if (!businessContext) return;
        const leadId = parseInt(req.params.id, 10);
        const requestedCustomerId = req.body?.customerId ?? req.body?.customer_id;
        const createNew = req.body?.createNew === true || req.body?.create_new === true;

        const leadResult = await client.query(
            `SELECT * FROM leads WHERE id = $1 AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2 LIMIT 1`,
            [leadId, businessContext]
        );
        if (!leadResult.rows.length) {
            return res.status(404).json({ success: false, error: 'Лід не знайдено' });
        }
        const lead = leadResult.rows[0];

        await client.query('BEGIN');

        let customer;
        let mode = 'linked_existing';
        if (requestedCustomerId) {
            const customerId = parseInt(requestedCustomerId, 10);
            if (!Number.isInteger(customerId) || customerId <= 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, error: 'customerId має бути додатним числом' });
            }
            const existing = await client.query(
                `SELECT * FROM customers WHERE id = $1 AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2 LIMIT 1`,
                [customerId, businessContext]
            );
            if (!existing.rows.length) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, error: 'Клієнта не знайдено' });
            }
            const existingCustomer = existing.rows[0];
            const linkNotes = appendUniqueLeadCustomerNote(existingCustomer.notes, buildLeadCustomerNotes(lead), leadId);
            const updated = await client.query(
                `UPDATE customers
                 SET lead_id = CASE WHEN lead_id IS NULL OR lead_id = $1 THEN $1 ELSE lead_id END,
                     phone = COALESCE(NULLIF(phone, ''), $2),
                     instagram = COALESCE(NULLIF(instagram, ''), $3),
                     source = COALESCE(NULLIF(source, ''), $4),
                     child_name = COALESCE(NULLIF(child_name, ''), $5),
                     notes = $6,
                     social_identities = $7::jsonb,
                     updated_at = NOW()
                 WHERE id = $8
                   AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $9
                 RETURNING *`,
                [
                    leadId,
                    cleanText(lead.phone),
                    normalizeInstagram(lead.instagram) || null,
                    leadCustomerSource(lead),
                    leadCustomerChildName(lead),
                    linkNotes,
                    JSON.stringify(mergeLeadSocialIdentities(existingCustomer.social_identities, lead)),
                    customerId,
                    businessContext
                ]
            );
            customer = updated.rows[0];
            await linkLeadCustomer(client, {
                businessContext,
                leadId,
                customerId: customer.id,
                linkType: 'operator_link',
                source: 'leads.link_customer',
                userId: req.user?.id,
                metadata: { requestedCustomerId: customer.id }
            });
        } else if (createNew) {
            const inserted = await client.query(
                `INSERT INTO customers (business_context, name, phone, instagram, child_name, source, notes, lead_id, social_identities)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
                 RETURNING *`,
                [
                    businessContext,
                    leadCustomerName(lead),
                    cleanText(lead.phone),
                    normalizeInstagram(lead.instagram) || null,
                    leadCustomerChildName(lead),
                    leadCustomerSource(lead),
                    buildLeadCustomerNotes(lead) || null,
                    leadId,
                    JSON.stringify(leadSocialIdentities(lead))
                ]
            );
            customer = inserted.rows[0];
            mode = 'created_new';
            await linkLeadCustomer(client, {
                businessContext,
                leadId,
                customerId: customer.id,
                linkType: 'operator_link',
                source: 'leads.link_customer',
                userId: req.user?.id,
                metadata: { createdNew: true }
            });
        } else {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Передайте customerId або createNew=true' });
        }

        const childSync = await syncLeadCelebrantsToCustomerChildren(client, lead, customer, businessContext);
        customer = childSync.customer || customer;

        const suggestionsResult = await client.query(`
            SELECT id, name, phone, instagram
            FROM customers
            WHERE id <> $1
              AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $4
              AND (
                ($2 <> '' AND regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = $2)
                OR ($3 <> '' AND lower(regexp_replace(COALESCE(instagram, ''), '^@+', '', 'g')) = $3)
              )
            ORDER BY updated_at DESC NULLS LAST, id DESC
            LIMIT 5
        `, [customer.id, normalizeDigits(customer.phone || lead.phone), normalizeInstagram(customer.instagram || lead.instagram), businessContext]);

        await client.query('COMMIT');
        res.json({
            success: true,
            mode,
            mergePolicy: 'suggest_only',
            customer: mapWorkspaceCustomer(customer),
            suggestions: suggestionsResult.rows.map(mapWorkspaceCustomer)
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('POST /leads/:id/link-customer error', err);
        res.status(500).json({ success: false, error: 'Помилка привʼязки клієнта' });
    } finally {
        client.release();
    }
});

// GET /api/leads/pipeline — pipeline funnel by stages (v29.1.0)
// Stages: new → contacted → info_sent → deal → deposit_received → waiting → completed → closed / lost
router.get('/pipeline', async (req, res) => {
    try {
        const businessScope = ensureBusinessScope(req, res);
        if (!businessScope) return;
        const countParams = [];
        const countScopeSql = leadScopeCondition(countParams, businessScope, '');
        const result = await pool.query(`
            SELECT pipeline_stage, lead_type, COUNT(*) AS count
            FROM leads
            WHERE ${countScopeSql}
            GROUP BY pipeline_stage, lead_type
        `, countParams);

        const stages = {};
        const allStages = {};
        const typeStats = emptyLeadTypeStats();
        const operationalQueueStats = Object.fromEntries(NON_SALES_LEAD_TYPES.map(type => [type, 0]));
        const stageOrder = ['new', 'contacted', 'info_sent', 'deal', 'deposit_received', 'waiting', 'completed', 'closed', 'lost'];
        for (const s of stageOrder) {
            stages[s] = 0;
            allStages[s] = 0;
        }
        for (const r of result.rows) {
            const key = r.pipeline_stage || 'new';
            const type = VALID_LEAD_TYPES.has(r.lead_type) ? r.lead_type : SALES_LEAD_TYPE;
            const count = parseInt(r.count, 10) || 0;
            allStages[key] = (allStages[key] || 0) + count;
            typeStats[type] = (typeStats[type] || 0) + count;
            if (type === SALES_LEAD_TYPE) {
                stages[key] = (stages[key] || 0) + count;
            } else if (Object.prototype.hasOwnProperty.call(operationalQueueStats, type)) {
                operationalQueueStats[type] += count;
            }
        }

        const listResult = await fetchLeadList({
            businessScope,
            query: { ...req.query, order: 'kanban', lead_type: req.query.lead_type || undefined },
            order: 'kanban',
            limit: req.query.limit || LEADS_MAX_LIMIT,
            offset: req.query.offset || 0
        });
        if (listResult.error) {
            return res.status(400).json({ success: false, error: listResult.error });
        }

        res.json({
            success: true,
            pipeline: stages,
            salesPipeline: stages,
            allPipeline: allStages,
            classificationStats: typeStats,
            operationalQueueStats,
            salesTotal: Object.values(stages).reduce((sum, value) => sum + value, 0),
            allTotal: Object.values(allStages).reduce((sum, value) => sum + value, 0),
            meta: {
                salesLeadType: SALES_LEAD_TYPE,
                excludedLeadTypes: NON_SALES_LEAD_TYPES
            },
            leads: listResult.leads,
            pagination: listResult.pagination,
            canonicalSource: '/api/leads?order=kanban'
        });
    } catch (err) {
        log.error('GET /leads/pipeline error', err);
        res.status(500).json({ success: false, error: 'Помилка' });
    }
});

// GET /api/leads/:id/workspace — unified manager workspace case composition
router.get('/:id/workspace', async (req, res) => {
    try {
        const businessContext = ensureBusinessContext(req, res);
        if (!businessContext) return;
        const leadId = parseInt(req.params.id, 10);
        if (!Number.isInteger(leadId) || leadId <= 0) {
            return res.status(400).json({ success: false, error: 'Некоректний ID ліда' });
        }

        const leadResult = await pool.query(`
            SELECT l.*, u.name AS assigned_name, u.username AS assigned_username,
                   p.label AS program_name, p.name AS program_full_name
            FROM leads l
            LEFT JOIN users u ON l.assigned_to = u.id
            LEFT JOIN products p ON l.program_id = p.id
            WHERE l.id = $1
              AND COALESCE(l.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2
            LIMIT 1
        `, [leadId, businessContext]);

        if (leadResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Лід не знайдено' });
        }

        const rawLead = leadResult.rows[0];
        const lead = mapWorkspaceLead(rawLead);

        let bookingCustomerId = null;
        if (lead.bookingId) {
            const bookingLinkParams = [lead.bookingId, businessContext];
            const bookingLinkScope = getVisibleBookingScope(req.user, bookingLinkParams, 'b');
            const bookingLinkResult = await pool.query(
                `SELECT b.customer_id FROM bookings b
                 WHERE b.id = $1
                   AND COALESCE(b.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2
                   ${bookingLinkScope.sql}
                 LIMIT 1`,
                bookingLinkParams
            );
            bookingCustomerId = bookingLinkResult.rows[0]?.customer_id || null;
        }

        const phoneDigits = normalizeDigits(lead.phone);
        const instagramKey = normalizeInstagram(lead.instagram);
        const customerLookupParams = [bookingCustomerId, leadId, phoneDigits, instagramKey, businessContext];
        const customerBookingScope = getVisibleBookingScope(req.user, customerLookupParams, 'b');
        const customerResult = await optionalWorkspaceQuery(`
            SELECT c.*,
                   COALESCE(b_agg.booking_count, 0) AS real_total_bookings,
                   COALESCE(b_agg.booking_spent, 0) AS real_total_spent,
                   b_agg.real_first_visit,
                   b_agg.real_last_visit
            FROM customers c
            LEFT JOIN (
                SELECT b.customer_id,
                       COUNT(*) AS booking_count,
                       COALESCE(SUM(b.price), 0) AS booking_spent,
                       MIN(b.date) AS real_first_visit,
                       MAX(b.date) AS real_last_visit
                FROM bookings b
                WHERE LOWER(COALESCE(NULLIF(BTRIM(b.status), ''), 'confirmed')) != 'cancelled'
                  AND COALESCE(b.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $5
                  ${customerBookingScope.sql}
                GROUP BY b.customer_id
            ) b_agg ON b_agg.customer_id = c.id
            WHERE COALESCE(c.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $5
              AND (
                   ($1::integer IS NOT NULL AND c.id = $1)
                   OR
                   EXISTS (
                       SELECT 1
                       FROM lead_customer_links lcl
                       WHERE lcl.customer_id = c.id
                         AND lcl.lead_id = $2
                         AND COALESCE(lcl.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $5
                   )
                   OR
                   c.lead_id = $2
                   OR ($3 <> '' AND regexp_replace(COALESCE(c.phone, ''), '\\D', '', 'g') = $3)
                   OR ($4 <> '' AND lower(regexp_replace(COALESCE(c.instagram, ''), '^@+', '', 'g')) = $4)
              )
            ORDER BY
                CASE
                    WHEN $1::integer IS NOT NULL AND c.id = $1 THEN 0
                    WHEN EXISTS (
                       SELECT 1
                       FROM lead_customer_links lcl
                       WHERE lcl.customer_id = c.id
                         AND lcl.lead_id = $2
                         AND COALESCE(lcl.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $5
                    ) THEN 1
                    WHEN c.lead_id = $2 THEN 2
                    WHEN $3 <> '' AND regexp_replace(COALESCE(c.phone, ''), '\\D', '', 'g') = $3 THEN 3
                    ELSE 4
                END,
                b_agg.real_last_visit DESC NULLS LAST,
                c.updated_at DESC
            LIMIT 1
        `, customerLookupParams);
        const customer = mapWorkspaceCustomer(customerResult.rows[0]);
        const customerId = customer?.id || bookingCustomerId || null;
        const customerCard = customer ? buildCustomerCardCompat(rawLead, customerResult.rows[0]) : null;

        const bookingConditions = [];
        const bookingParams = [];
        if (customerId) {
            bookingParams.push(customerId);
            bookingConditions.push(`b.customer_id = $${bookingParams.length}`);
        }
        if (lead.bookingId) {
            bookingParams.push(String(lead.bookingId));
            bookingConditions.push(`b.id = $${bookingParams.length}`);
        }
        bookingParams.push(businessContext);
        const bookingBusinessRef = `$${bookingParams.length}`;
        const bookingVisibility = getVisibleBookingScope(req.user, bookingParams, 'b');
        const bookingsResult = bookingConditions.length > 0
            ? await pool.query(`
                SELECT b.*
                FROM bookings b
                WHERE (${bookingConditions.join(' OR ')})
                  AND COALESCE(b.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = ${bookingBusinessRef}
                  AND NULLIF(b.linked_to, '') IS NULL
                  ${bookingVisibility.sql}
                ORDER BY b.date DESC NULLS LAST, b.time DESC NULLS LAST
                LIMIT 12
            `, bookingParams)
            : { rows: [] };
        const bookings = bookingsResult.rows.map(row => mapWorkspaceBooking(row, lead.bookingId));
        const bookingIds = bookings.map(b => String(b.id)).filter(Boolean);
        const exactBookingIds = bookings
            .filter(b => b.isLeadBooking)
            .map(b => String(b.id))
            .filter(Boolean);

        const taskConditions = [];
        const taskParams = [];
        taskParams.push(String(lead.id));
        taskConditions.push(`(t.source_type = 'lead' AND t.source_id = $${taskParams.length})`);
        if (bookingIds.length > 0) {
            taskParams.push(bookingIds);
            taskConditions.push(`(t.source_type = 'booking' AND t.source_id = ANY($${taskParams.length}::text[]))`);
        }
        if (lead.phone) {
            taskParams.push(`%${lead.phone}%`);
            taskConditions.push(`(t.description ILIKE $${taskParams.length} OR t.title ILIKE $${taskParams.length})`);
        }
        if (lead.clientName) {
            taskParams.push(`%${lead.clientName}%`);
            taskConditions.push(`(t.description ILIKE $${taskParams.length} OR t.title ILIKE $${taskParams.length})`);
        }
        taskParams.push(businessContext);
        const taskBusinessRef = `$${taskParams.length}`;
        const taskVisibility = buildTaskVisibilityScope(req.user, taskParams, 't');
        const tasksResult = taskConditions.length > 0
            ? await optionalWorkspaceQuery(`
                SELECT t.*
                FROM tasks t
                WHERE (${taskConditions.join(' OR ')})
                  AND COALESCE(t.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = ${taskBusinessRef}
                  ${taskVisibility}
                ORDER BY
                    CASE WHEN t.status = 'done' THEN 3 WHEN t.status = 'in_progress' THEN 0 ELSE 1 END,
                    CASE WHEN t.deadline IS NOT NULL AND t.deadline < NOW() THEN 0 ELSE 1 END,
                    CASE t.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 WHEN 'low' THEN 2 ELSE 3 END,
                    COALESCE(t.deadline, t.created_at) ASC
                LIMIT 12
            `, taskParams)
            : { rows: [] };
        const tasks = tasksResult.rows.map(row => mapWorkspaceTask(row, lead.id, exactBookingIds));

        const interactionsResult = await optionalWorkspaceQuery(`
            SELECT li.*, u.name AS manager_name
            FROM lead_interactions li
            LEFT JOIN users u ON li.user_id = u.id
            WHERE li.lead_id = $1
            ORDER BY li.created_at DESC
            LIMIT 10
        `, [leadId]);

        const communicationsResult = customerId
            ? await optionalWorkspaceQuery(`
                SELECT cl.*, u.name AS created_by_name
                FROM communication_log cl
                LEFT JOIN users u ON cl.created_by = u.id
                WHERE cl.customer_id = $1
                ORDER BY cl.created_at DESC
                LIMIT 8
            `, [customerId])
            : { rows: [] };

        const conversationConditions = [];
        const conversationParams = [];
        if (customerId) {
            conversationParams.push(customerId);
            conversationConditions.push(`c.customer_id = $${conversationParams.length}`);
        }
        if (phoneDigits) {
            conversationParams.push(phoneDigits);
            conversationConditions.push(`regexp_replace(COALESCE(c.customer_phone, ''), '\\D', '', 'g') = $${conversationParams.length}`);
        }
        if (lead.clientName) {
            conversationParams.push(`%${lead.clientName}%`);
            conversationConditions.push(`c.customer_name ILIKE $${conversationParams.length}`);
        }
        const conversationsResult = conversationConditions.length > 0
            ? await optionalWorkspaceQuery(`
                SELECT c.id, c.channel, c.customer_name, c.customer_phone, c.customer_id, c.status,
                       c.assigned_to, c.unread_count, c.last_message_at, c.updated_at,
                       c.last_inbound_at, c.last_outbound_at,
                       c.reply_expected, c.awaiting_reply_since, c.reply_expected_message_id,
                       c.reply_owner, c.reply_owner_user_id, c.reply_sla_at,
                       expected_msg.delivery_status AS reply_expected_delivery_status,
                       m.content AS last_message
                FROM conversations c
                LEFT JOIN conversation_messages expected_msg ON expected_msg.id = c.reply_expected_message_id
                LEFT JOIN LATERAL (
                    SELECT content
                    FROM conversation_messages
                    WHERE conversation_id = c.id
                    ORDER BY created_at DESC
                    LIMIT 1
                ) m ON true
                WHERE ${conversationConditions.join(' OR ')}
                ORDER BY c.last_message_at DESC NULLS LAST, c.updated_at DESC
                LIMIT 8
            `, conversationParams)
            : { rows: [] };

        const eventDates = [
            lead.eventDate,
            ...bookings.map(b => b.date)
        ].map(toDateOnly).filter(Boolean).sort();
        const nextEventDate = eventDates.find(d => calculateDaysUntil(d) >= 0) || eventDates[0] || null;
        const openTasks = tasks.filter(t => !['done', 'cancelled'].includes(t.status));
        const overdueTasks = openTasks.filter(t => t.deadline && new Date(t.deadline) < new Date());
        const dueSoonTasks = openTasks.filter(t => {
            if (!t.deadline) return false;
            const diffHours = (new Date(t.deadline) - new Date()) / 3600000;
            return diffHours >= 0 && diffHours <= 48;
        });
        const dueFollowUps = interactionsResult.rows.filter(i => i.follow_up_date && !i.follow_up_done && calculateDaysUntil(i.follow_up_date) <= 1);

        res.json({
            success: true,
            workspace: {
                lead,
                canonical: {
                    statusField: 'pipeline_stage',
                    stage: lead.pipelineStage,
                    aggregateStatus: lead.status,
                    aggregateStatusFromStage: STAGE_TO_STATUS[lead.pipelineStage] || lead.status || 'new'
                },
                customer,
                customerCard,
                bookings,
                tasks,
                interactions: interactionsResult.rows,
                communications: communicationsResult.rows,
                conversations: conversationsResult.rows.map(c => ({
                    id: c.id,
                    channel: c.channel,
                    customerName: c.customer_name,
                    customerPhone: c.customer_phone,
                    customerId: c.customer_id,
                    confidence: customerId && Number(c.customer_id) === Number(customerId) ? 'exact' : 'suggested',
                    status: c.status,
                    assignedTo: c.assigned_to,
                    unreadCount: c.unread_count,
                    lastMessageAt: c.last_message_at,
                    lastInboundAt: c.last_inbound_at,
                    lastOutboundAt: c.last_outbound_at,
                    replyExpected: booleanValue(c.reply_expected),
                    awaitingReplySince: c.awaiting_reply_since,
                    replyExpectedMessageId: c.reply_expected_message_id,
                    replyOwner: c.reply_owner,
                    replyOwnerUserId: c.reply_owner_user_id || null,
                    replySlaAt: c.reply_sla_at,
                    replySlaState: deriveReplySlaState(c),
                    waitingReply: isActiveWaitingReply(c),
                    replyDeliveryStatus: c.reply_expected_delivery_status,
                    lastMessage: c.last_message
                })),
                urgency: {
                    eventDate: nextEventDate,
                    daysUntilEvent: calculateDaysUntil(nextEventDate),
                    openTasks: openTasks.length,
                    overdueTasks: overdueTasks.length,
                    dueSoonTasks: dueSoonTasks.length,
                    dueFollowUps: dueFollowUps.length
                }
            }
        });
    } catch (err) {
        log.error('GET /leads/:id/workspace error', err);
        res.status(500).json({ success: false, error: 'Помилка завантаження робочого простору ліда' });
    }
});

// ============================================================
// v29.1.0: Mailing List (MUST be before /:id routes)
// ============================================================

// GET /api/leads/mailing — get mailing list
router.get('/mailing', async (req, res) => {
    try {
        const businessContext = ensureBusinessContext(req, res);
        if (!businessContext) return;
        const result = await pool.query(`
            SELECT m.*, l.client_name AS lead_name
            FROM mailing_list m
            LEFT JOIN leads l
              ON m.lead_id = l.id
             AND COALESCE(l.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $1
            WHERE COALESCE(m.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $1
            ORDER BY m.created_at DESC LIMIT 500
        `, [businessContext]);
        res.json({ success: true, list: result.rows });
    } catch (err) {
        log.error('GET /leads/mailing error', err);
        res.status(500).json({ success: false, error: 'Помилка' });
    }
});

// POST /api/leads/mailing — add contact to mailing list
router.post('/mailing', async (req, res) => {
    try {
        const businessContext = ensureBusinessContext(req, res);
        if (!businessContext) return;
        const { name, phone, email, source_channel, contact_value, lead_id, notes } = req.body;
        if (!name && !phone) {
            return res.status(400).json({ success: false, error: "Ім'я або телефон обов'язкові" });
        }
        const result = await pool.query(`
            INSERT INTO mailing_list (business_context, name, phone, email, source_channel, contact_value, lead_id, notes)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (business_context, phone) WHERE phone IS NOT NULL DO UPDATE SET
                name = COALESCE(EXCLUDED.name, mailing_list.name),
                email = COALESCE(EXCLUDED.email, mailing_list.email),
                source_channel = COALESCE(EXCLUDED.source_channel, mailing_list.source_channel),
                notes = COALESCE(EXCLUDED.notes, mailing_list.notes)
            RETURNING *
        `, [businessContext, name || null, phone || null, email || null, source_channel || null,
            contact_value || null, lead_id || null, notes || null]);

        res.json({ success: true, entry: result.rows[0] });
    } catch (err) {
        log.error('POST /leads/mailing error', err);
        res.status(500).json({ success: false, error: 'Помилка додавання до розсилки' });
    }
});

// DELETE /api/leads/mailing/:id — remove from mailing list
router.delete('/mailing/:id', async (req, res) => {
    try {
        const businessContext = ensureBusinessContext(req, res);
        if (!businessContext) return;
        const result = await pool.query(
            `DELETE FROM mailing_list
             WHERE id = $1 AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2
             RETURNING id`,
            [req.params.id, businessContext]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Запис не знайдено' });
        }
        res.json({ success: true });
    } catch (err) {
        log.error('DELETE /leads/mailing/:id error', err);
        res.status(500).json({ success: false, error: 'Помилка' });
    }
});

// DELETE /api/leads/:id
router.delete('/:id', requireMinRole('manager'), async (req, res) => {
    try {
        const businessContext = ensureBusinessContext(req, res);
        if (!businessContext) return;
        const result = await pool.query(
            `DELETE FROM leads
             WHERE id = $1 AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2
             RETURNING id`,
            [req.params.id, businessContext]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Лід не знайдено' });
        }
        res.json({ success: true });
    } catch (err) {
        log.error('DELETE /leads/:id error', err);
        res.status(500).json({ success: false, error: 'Помилка видалення' });
    }
});

// ============================================================
// v23.4.0: Lead Capture Webhooks
// ============================================================

/** Compat helper for legacy channel webhooks; canonical dedup/upsert lives in upsertUniversalWebhookLead. */
async function createLeadFromWebhook({ client_name, phone, telegram_id, instagram,
                                       notes, source_channel, external_id, raw_payload,
                                       businessContext = DEFAULT_BUSINESS_CONTEXT }) {
    businessContext = normalizeBusinessContext(businessContext);
    const sourceChannel = normalizeWebhookSource(source_channel || 'legacy');
    const isTestMode = process.env.TEST_MODE === 'true';
    if (isTestMode && client_name) client_name = `[TEST] ${client_name}`;
    const payload = {
        client_name: client_name || null,
        phone: phone || null,
        telegram_id: telegram_id || null,
        instagram: stripAt(instagram),
        source_channel: sourceChannel,
        external_id: external_id || null,
        event_date: null,
        session_type: null,
        quality_category: null,
        contact_channels: [],
        raw_payload: raw_payload || {}
    };
    const result = await upsertUniversalWebhookLead(payload, businessContext, sourceChannel, notes || '');
    return result.created ? result.lead : null;
}

// GET /api/leads/webhook/facebook — Meta verification
router.get('/webhook/facebook', (req, res) => {
    if (req.query['hub.mode'] === 'subscribe' &&
        req.query['hub.verify_token'] === FB_VERIFY_TOKEN) {
        log.info('Facebook webhook verified');
        return res.status(200).send(req.query['hub.challenge']);
    }
    res.sendStatus(403);
});

// POST /api/leads/webhook/facebook — Facebook Lead Ads
router.post('/webhook/facebook', async (req, res) => {
    res.sendStatus(200); // Meta expects fast response
    try {
        if (req.body.object !== 'page') return;

        for (const entry of (req.body.entry || [])) {
            for (const change of (entry.changes || [])) {
                if (change.field !== 'leadgen') continue;
                const leadgenId = change.value?.leadgen_id;
                if (!leadgenId || !FB_PAGE_ACCESS_TOKEN) continue;

                // Fetch lead data via Graph API
                const https = require('https');
                const fbData = await new Promise((resolve, reject) => {
                    const url = `https://graph.facebook.com/v21.0/${leadgenId}`;
                    const options = {
                        headers: { 'Authorization': `Bearer ${FB_PAGE_ACCESS_TOKEN}` }
                    };
                    https.get(url, options, (resp) => {
                        let data = '';
                        resp.on('data', c => data += c);
                        resp.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
                    }).on('error', reject);
                });

                const fields = Object.fromEntries(
                    (fbData.field_data || []).map(f => [f.name, f.values?.[0] || ''])
                );

                const lead = await createLeadFromWebhook({
                    client_name:    fields.full_name || fields.first_name || null,
                    phone:          fields.phone_number || null,
                    instagram:      fields.instagram || null,
                    notes:          `Facebook Lead Ad | ${fbData.ad_name || leadgenId}`,
                    source_channel: 'facebook',
                    businessContext: publicBusinessContext(req),
                    external_id:    `fb_${leadgenId}`,
                    raw_payload:    fbData,
                });

                if (lead) {
                    notifyNewLead(lead).catch(() => {});
                    log.info(`New FB lead: ${lead.client_name}`);
                }
            }
        }
    } catch (err) {
        log.error('Facebook webhook processing error', err);
    }
});

// GET /api/leads/webhook/instagram — Meta verification (same token as FB)
router.get('/webhook/instagram', (req, res) => {
    if (req.query['hub.mode'] === 'subscribe' &&
        req.query['hub.verify_token'] === FB_VERIFY_TOKEN) {
        log.info('Instagram webhook verified');
        return res.status(200).send(req.query['hub.challenge']);
    }
    res.sendStatus(403);
});

// POST /api/leads/webhook/instagram — Instagram DM / Lead Ads
router.post('/webhook/instagram', async (req, res) => {
    res.sendStatus(200);
    try {
        for (const entry of (req.body.entry || [])) {
            for (const messaging of (entry.messaging || [])) {
                const senderId = messaging.sender?.id;
                const text     = messaging.message?.text;
                if (!senderId || !text) continue;

                const lead = await createLeadFromWebhook({
                    client_name:    `IG_${senderId}`,
                    notes:          text.slice(0, 500),
                    source_channel: 'instagram',
                    businessContext: publicBusinessContext(req),
                    external_id:    `ig_${senderId}`,
                    raw_payload:    messaging,
                });

                if (lead) {
                    notifyNewLead(lead).catch(() => {});
                    log.info(`New IG lead: ig_${senderId}`);
                }
            }
        }
    } catch (err) {
        log.error('Instagram webhook error', err);
    }
});

// POST /api/leads/webhook/viber — Viber Business Messages
router.post('/webhook/viber', async (req, res) => {
    try {
        // Signature verification
        if (VIBER_AUTH_TOKEN) {
            const sig = req.headers['x-viber-content-signature'] || '';
            const bodyStr = JSON.stringify(req.body);
            const expected = crypto
                .createHmac('sha256', VIBER_AUTH_TOKEN)
                .update(bodyStr)
                .digest('hex');
            const sigBuf = Buffer.from(sig, 'hex');
            const expBuf = Buffer.from(expected, 'hex');
            if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
                return res.status(401).json({ error: 'Invalid signature' });
            }
        }

        res.sendStatus(200);

        const { event, sender, message } = req.body;
        if (!['message', 'conversation_started'].includes(event)) return;

        const lead = await createLeadFromWebhook({
            client_name:    sender?.name || `Viber_${sender?.id}`,
            notes:          message?.text?.slice(0, 500) || 'Нове звернення через Viber',
            source_channel: 'viber',
            businessContext: publicBusinessContext(req),
            external_id:    `viber_${sender?.id}`,
            raw_payload:    req.body,
        });

        if (lead) {
            notifyNewLead(lead).catch(() => {});
            log.info(`New Viber lead: ${sender?.name}`);
        }
    } catch (err) {
        log.error('Viber webhook error', err);
    }
});

// ============================================================
// v29.1.0: Customer Cards
// ============================================================

// GET /api/leads/:id/card — get customer card for lead
router.get('/:id/card', async (req, res) => {
    try {
        const businessContext = ensureBusinessContext(req, res);
        if (!businessContext) return;
        const leadResult = await pool.query(
            `SELECT *
             FROM leads
             WHERE id = $1 AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2
             LIMIT 1`,
            [req.params.id, businessContext]
        );
        if (!leadResult.rows.length) {
            return res.json({ success: true, deprecated: true, card: null, customer: null });
        }
        const lead = leadResult.rows[0];
        const customer = await findCustomerForLead(pool, lead, businessContext);
        res.json({
            success: true,
            deprecated: true,
            source: 'customers',
            card: customer ? buildCustomerCardCompat(lead, customer) : null,
            customer: mapWorkspaceCustomer(customer)
        });
    } catch (err) {
        log.error('GET /leads/:id/card error', err);
        res.status(500).json({ success: false, error: 'Помилка' });
    }
});

// POST /api/leads/:id/card — create/update customer card
router.post('/:id/card', async (req, res) => {
    let client;
    try {
        const businessContext = ensureBusinessContext(req, res);
        if (!businessContext) return;
        const leadId = parseInt(req.params.id, 10);
        if (!Number.isInteger(leadId) || leadId <= 0) {
            return res.status(400).json({ success: false, error: 'Некоректний ID ліда' });
        }
        const { event_type, event_date, guest_count, children_count, budget_approx, how_found, email, channel, notes } = req.body;
        const budgetValue = parseOptionalNonNegativeInt(budget_approx, 'budget_approx');
        if (budgetValue.error) {
            return res.status(400).json({ success: false, error: budgetValue.error });
        }

        client = await pool.connect();
        await client.query('BEGIN');

        const leadResult = await client.query(
            `SELECT *
             FROM leads
             WHERE id = $1 AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2
             FOR UPDATE`,
            [leadId, businessContext]
        );
        if (leadResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Лід не знайдено' });
        }

        let lead = leadResult.rows[0];
        const leadUpdates = [];
        const leadParams = [];
        if (event_date !== undefined) {
            leadParams.push(event_date || null);
            leadUpdates.push(`event_date = $${leadParams.length}`);
        }
        if (children_count !== undefined) {
            leadParams.push(children_count || null);
            leadUpdates.push(`children_count = $${leadParams.length}`);
        }
        if (budgetValue.provided) {
            leadParams.push(budgetValue.value);
            leadUpdates.push(`potential_value = $${leadParams.length}`);
        }
        if (leadUpdates.length) {
            leadParams.push(leadId, businessContext);
            const updatedLead = await client.query(
                `UPDATE leads
                 SET ${leadUpdates.join(', ')}, updated_at = NOW()
                 WHERE id = $${leadParams.length - 1}
                   AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $${leadParams.length}
                 RETURNING *`,
                leadParams
            );
            lead = updatedLead.rows[0] || lead;
        }

        const ensured = await ensureDealCustomerForLead(client, lead, businessContext, {
            userId: req.user?.id,
            source: 'leads.card_compat',
            linkType: 'legacy_card_compat'
        });
        const legacyNote = buildLegacyCustomerCardNotes(leadId, {
            id: `lead:${leadId}`,
            event_type: event_type || null,
            event_date: event_date || null,
            guest_count: guest_count || null,
            children_count: children_count || null,
            budget_approx: budgetValue.provided ? budgetValue.value : null,
            how_found: how_found || null,
            email: email || null,
            channel: channel || null,
            notes: notes || null
        });
        let customer = ensured?.customer || null;
        if (customer && legacyNote.text) {
            const nextNotes = upsertMarkedNote(customer.notes, legacyNote.marker, legacyNote.text);
            if (nextNotes !== cleanText(customer.notes)) {
                const customerUpdate = await client.query(
                    `UPDATE customers
                     SET notes = $1, updated_at = NOW()
                     WHERE id = $2
                       AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $3
                     RETURNING *`,
                    [nextNotes, customer.id, businessContext]
                );
                customer = customerUpdate.rows[0] || customer;
            }
        }

        await client.query('COMMIT');
        log.info(`Customer compat card saved to customers for lead ${leadId}`);
        res.json({
            success: true,
            deprecated: true,
            source: 'customers',
            card: buildCustomerCardCompat(lead, customer),
            customer: mapWorkspaceCustomer(customer),
            customerLinkMode: ensured?.mode || null
        });
    } catch (err) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        log.error('POST /leads/:id/card error', err);
        res.status(500).json({ success: false, error: 'Помилка збереження картки' });
    } finally {
        if (client) client.release();
    }
});

// ============================================================
// v29.1.0: Deposit auto-distribute (fire-and-forget)
// ============================================================

function subtractDays(dateStr, days) {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    d.setDate(d.getDate() - days);
    return d.toISOString().split('T')[0];
}

function taskActiveSql(alias = 't') {
    return `COALESCE(${alias}.status, 'todo') NOT IN ('done','archived','cancelled')`;
}

function depositContextLabel(value, fallback) {
    return cleanText(value) || fallback;
}

function depositTaskClientName(lead = {}, projection = {}) {
    return depositContextLabel(
        projection.display?.clientName
            || projection.deposit?.clientNameSnapshot
            || lead.client_name
            || lead.phone
            || lead.instagram,
        `lead #${lead.id}`
    );
}

function depositTaskEventDate(lead = {}, projection = {}) {
    return depositContextLabel(
        projection.display?.eventDate
            || projection.deposit?.eventDate
            || lead.event_date,
        'not specified'
    );
}

function depositTaskBanquetNumber(projection = {}, context = {}) {
    return depositContextLabel(
        projection.display?.banquetNumber
            || projection.deposit?.banquetNumberSnapshot
            || projection.banquetGroupId
            || projection.bookingId
            || context.banquetGroupId
            || context.primaryBookingId
            || context.bookingId,
        projection.needsBookingLink ? 'booking link required' : 'not specified'
    );
}

async function findActiveDepositTask(depositId, businessContext) {
    const id = parseInt(depositId, 10);
    if (!Number.isInteger(id) || id <= 0) return null;
    const result = await pool.query(
        `SELECT *
           FROM tasks t
          WHERE ${taskActiveSql('t')}
            AND COALESCE(t.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $1
            AND (
                (t.source_type = 'banquet_deposit' AND t.source_id = $2)
                OR (t.source_entity_type = 'banquet_deposit' AND t.source_entity_id = $2)
            )
          ORDER BY t.id ASC
          LIMIT 1`,
        [businessContext, String(id)]
    );
    return result.rows[0] || null;
}

async function loadActiveTaskById(taskId, businessContext) {
    const id = parseInt(taskId, 10);
    if (!Number.isInteger(id) || id <= 0) return null;
    const result = await pool.query(
        `SELECT *
           FROM tasks t
          WHERE t.id = $1
            AND ${taskActiveSql('t')}
            AND COALESCE(t.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2
          LIMIT 1`,
        [id, businessContext]
    );
    return result.rows[0] || null;
}

async function findAccountantTaskOwner(businessContext) {
    const result = await pool.query(
        `SELECT id, username, name, role
           FROM users
          WHERE COALESCE(is_active, true) = true
            AND (
                role = 'accountant'
                OR 'accountant' = ANY(COALESCE(extra_roles, ARRAY[]::text[]))
            )
            AND (
                business_contexts IS NULL
                OR array_length(business_contexts, 1) IS NULL
                OR $1 = ANY(business_contexts)
            )
          ORDER BY CASE WHEN role = 'accountant' THEN 0 ELSE 1 END,
                   COALESCE(NULLIF(name, ''), username),
                   id
          LIMIT 1`,
        [businessContext]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
        id: row.id,
        username: row.username,
        name: row.name || null,
        label: row.name || row.username || `User #${row.id}`
    };
}

function buildDepositAccountantTaskPayload({ lead, user, businessContext, handoff, accountant }) {
    const projection = handoff?.projection || {};
    const context = handoff?.context || {};
    const deposit = handoff?.deposit || projection.deposit || {};
    const depositId = deposit.id || projection.deposit?.id;
    const clientName = depositTaskClientName(lead, projection);
    const eventDate = depositTaskEventDate(lead, projection);
    const banquetNumber = depositTaskBanquetNumber(projection, context);
    const bookingId = projection.bookingId || context.primaryBookingId || context.bookingId || lead.booking_id || null;
    const banquetGroupId = projection.banquetGroupId || context.banquetGroupId || null;
    const needsBookingLink = projection.needsBookingLink === true || deposit.status === 'needs_booking_link';
    const missingBookingLine = needsBookingLink
        ? "Booking is not linked yet: first link the lead to a booking/banquet, then confirm the deposit."
        : `Booking: ${bookingId || 'not specified'}.`;

    return {
        title: `Завдаток: перевірити оплату - ${clientName}`,
        description: [
            'Перевірити, чи надійшов завдаток, і заповнити підтвердження.',
            `Клієнт: ${clientName}.`,
            `Дата святкування: ${eventDate}.`,
            `Банкет: ${banquetNumber}.`,
            missingBookingLine,
            `Лід: #${lead.id}.`,
            'Потрібно зафіксувати суму, спосіб внесення (cash/card) і дату отримання.'
        ].filter(Boolean).join('\n'),
        category: 'finance',
        subcategory: 'banquet_deposit',
        date: todayKyivDateString(),
        priority: needsBookingLink ? 'high' : 'normal',
        created_by: user?.username || user?.id || 'lead_deposit',
        created_by_user_id: user?.id || null,
        source_type: 'banquet_deposit',
        source_id: String(depositId),
        source_entity_type: 'banquet_deposit',
        source_entity_id: String(depositId),
        owner_user_id: accountant?.id || null,
        assigned_to: accountant?.label || 'Бухгалтер',
        owner: accountant?.label || 'Бухгалтер',
        owner_role: 'accountant',
        businessContext,
        duplicateMode: 'skip',
        source_module: 'leads.deposit_received',
        control_meta: {
            depositId,
            leadId: lead.id,
            bookingId,
            banquetGroupId,
            businessContext,
            actionRoute: 'PATCH /api/leads/:id',
            stage: 'deposit_received',
            needsBookingLink,
            clientName,
            eventDate,
            banquetNumber
        }
    };
}

async function createAccountantDepositTaskOnce(lead, user, options = {}) {
    if (!options.enteredDepositStage) return null;
    const businessContext = normalizeBusinessContext(options.businessContext || lead.business_context || lead.businessContext);
    const handoff = await getBanquetDeposits().createOrLoadDepositHandoff({
        leadId: lead.id,
        businessContext,
        user,
        source: 'leads.deposit_received',
        sourceKind: 'manager_handoff',
        sourcePayload: {
            route: 'PATCH /api/leads/:id',
            oldStage: options.oldStage || null,
            newStage: options.newStage || 'deposit_received',
            bookingId: lead.booking_id || null
        },
        meta: {
            actionRoute: 'PATCH /api/leads/:id',
            actorUserId: user?.id || null
        }
    });
    const depositId = handoff?.deposit?.id || handoff?.projection?.deposit?.id;
    if (!depositId) {
        log.warn(`[LeadDeposit] Handoff did not return deposit id for lead ${lead.id}`);
        return null;
    }

    const existingStoredTask = handoff.deposit?.accountantTaskId
        ? await loadActiveTaskById(handoff.deposit.accountantTaskId, businessContext)
        : null;
    const existingSourceTask = existingStoredTask || await findActiveDepositTask(depositId, businessContext);
    if (existingSourceTask?.id) {
        if (!handoff.deposit?.accountantTaskId || Number(handoff.deposit.accountantTaskId) !== Number(existingSourceTask.id)) {
            await getBanquetDeposits().attachAccountantTask({
                depositId,
                businessContext,
                accountantTaskId: existingSourceTask.id,
                sourcePayload: { source: 'leads.deposit_received.reuse_active_task' },
                meta: { reusedActiveTask: true }
            });
        }
        return existingSourceTask;
    }

    const accountant = await findAccountantTaskOwner(businessContext);
    const task = await getKleshnya().createTask(
        buildDepositAccountantTaskPayload({ lead, user, businessContext, handoff, accountant })
    );
    if (task?.id) {
        await getBanquetDeposits().attachAccountantTask({
            depositId,
            businessContext,
            accountantTaskId: task.id,
            sourcePayload: { source: 'leads.deposit_received.create_task' },
            meta: { createdFromLeadStage: true }
        });
    }
    return task;
}

async function onDepositReceived(lead, user, options = {}) {
    const isTestMode = process.env.TEST_MODE === 'true';
    const prefix = isTestMode ? '[TEST] ' : '';
    const businessContext = normalizeBusinessContext(options.businessContext || lead.business_context || lead.businessContext);
    const tasks = [];

    try {
        await createAccountantDepositTaskOnce(lead, user, {
            ...options,
            businessContext
        });
    } catch (e) {
        log.error('Failed to create accountant deposit task', e);
    }

    // 1. Art department (poster)
    tasks.push({
        title: `${prefix}Афіша: ${lead.quality_category || 'подія'} — ${lead.client_name}`,
        description: `Дата події: ${lead.event_date || 'не вказана'}. Клієнт: ${lead.phone || 'тел не вказано'}`,
        category: 'art',
        due_date: subtractDays(lead.event_date, 3),
        priority: 'high'
    });

    // 2. Kitchen (menu)
    tasks.push({
        title: `${prefix}Меню: ${lead.quality_category || 'подія'} ${lead.event_date || ''}`,
        description: `Клієнт: ${lead.client_name}`,
        category: 'kitchen',
        due_date: subtractDays(lead.event_date, 2),
        priority: 'medium'
    });

    // 3. Admin (staffing)
    tasks.push({
        title: `${prefix}Персонал: ${lead.event_date || 'дата TBD'} — скільки людей потрібно`,
        description: `Клієнт: ${lead.client_name}, тип: ${lead.quality_category || 'не вказано'}`,
        category: 'admin',
        due_date: subtractDays(lead.event_date, 3),
        priority: 'high'
    });

    for (const task of tasks) {
        try {
            await getKleshnya().createTask({
                title: task.title,
                description: task.description,
                category: task.category || 'sales',
                date: task.due_date || null,
                priority: task.priority || 'normal',
                created_by: user?.username || user?.id || 'lead_deposit',
                source_type: 'lead',
                source_id: String(lead.id),
                source_entity_type: 'lead',
                source_entity_id: String(lead.id),
                businessContext,
                duplicateMode: 'skip'
            });
        } catch (e) {
            log.error(`Failed to create task: ${task.title}`, e);
        }
    }

    // Telegram notification to director (if available)
    try {
        const { sendTelegramMessage } = require('../services/telegram');
        const chatId = process.env.BOSS_TELEGRAM_ID || process.env.TELEGRAM_DEFAULT_CHAT_ID;
        if (chatId && typeof sendTelegramMessage === 'function') {
            await sendTelegramMessage(chatId,
                `💰 ${prefix}Завдаток отримано!\n` +
                `Клієнт: ${lead.client_name}\n` +
                `Подія: ${lead.quality_category || 'не вказано'} ${lead.event_date || ''}\n` +
                `📋 Створено ${tasks.length} задач(і)`
            );
        }
    } catch (e) { /* non-blocking */ }

    log.info(`Deposit received for lead ${lead.id}: ${tasks.length} tasks created`);
}

async function onCollaborationLead(lead, user) {
    const contact = [lead.phone, lead.instagram ? `@${lead.instagram}` : null].filter(Boolean).join(' / ');
    await getKleshnya().createTask({
        title: `Співпраця: ${lead.client_name || contact || `лід #${lead.id}`}`,
        description: [
            `Оцінити запит на співпрацю з ліда #${lead.id}.`,
            lead.client_name ? `Контакт: ${lead.client_name}` : null,
            contact ? `Канал: ${contact}` : null,
            lead.notes ? `Нотатки: ${String(lead.notes).slice(0, 600)}` : null
        ].filter(Boolean).join('\n'),
        category: 'operational',
        date: todayKyivDateString(),
        priority: 'normal',
        created_by: user?.username || user?.id || 'lead_collaboration',
        created_by_user_id: user?.id || null,
        source_type: 'lead',
        source_id: String(lead.id),
        source_entity_type: 'lead',
        source_entity_id: String(lead.id),
        businessContext: normalizeBusinessContext(lead.business_context || lead.businessContext),
        duplicateMode: 'skip'
    });
}

// Log pipeline stage change to lead_interactions
async function logStageChange(queryable, { leadId, oldStage, newStage, oldStatus, newStatus, userId }) {
    await queryable.query(`
        INSERT INTO lead_interactions (lead_id, user_id, type, summary, details, created_at)
        VALUES ($1, $2, 'status_change', $3, $4::jsonb, NOW())
    `, [
        leadId,
        userId || null,
        `Pipeline: ${oldStage || 'new'} -> ${newStage || 'new'}`,
        JSON.stringify({
            oldStage: oldStage || 'new',
            newStage: newStage || 'new',
            oldStatus: oldStatus || null,
            newStatus: newStatus || null,
            source: 'leads.patch'
        })
    ]);
}

// Auto-add to mailing list
async function addToMailingIfNeeded(lead) {
    if (!lead.phone && !lead.client_name) return;
    const businessContext = normalizeBusinessContext(lead.business_context || lead.businessContext);
    const noteByType = {
        informational: 'Інформаційний запит',
        low_quality: 'Неякісний лід / майбутній контакт',
        collaboration: 'Співпраця',
        quality: 'Втрачений клієнт'
    };
    try {
        await pool.query(`
            INSERT INTO mailing_list (business_context, name, phone, source_channel, lead_id, notes)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (business_context, phone) WHERE phone IS NOT NULL DO NOTHING
        `, [businessContext, lead.client_name, lead.phone, lead.source_channel || 'unknown', lead.id,
            noteByType[lead.lead_type || 'quality'] || 'Втрачений клієнт']);
    } catch (e) { /* dedup */ }
}

// GET /api/leads/new-count — count new leads (for sidebar badge)
router.get('/new-count', async (req, res) => {
    try {
        const businessContext = ensureBusinessContext(req, res);
        if (!businessContext) return;
        const r = await pool.query(
            `SELECT COUNT(*)::int AS count
             FROM leads
             WHERE COALESCE(pipeline_stage, 'new') = 'new'
               AND COALESCE(lead_type, 'quality') = 'quality'
               AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $1`,
            [businessContext]
        );
        res.json({ count: r.rows[0].count });
    } catch (err) { res.json({ count: 0 }); }
});

module.exports = router;

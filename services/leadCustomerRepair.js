'use strict';

const {
    DEFAULT_BUSINESS_CONTEXT,
    normalizeBusinessContext
} = require('./businessContext');
const {
    auditLeadCustomerCards,
    normalizeInstagram,
    normalizedBusinessContextSql
} = require('./leadCustomerAudit');
const { auditLeadCustomerChildrenSync } = require('./customerDataAudits');
const { normalizeCustomerSource } = require('./customerSource');
const {
    replaceCustomerChildren,
    buildCustomerChildrenProjection,
    buildLegacyChildSnapshot,
    validateChildBirthday
} = require('./customerChildren');

const CARD_REPAIR_ACTIONS = Object.freeze({
    CREATE_CUSTOMER: 'create_customer',
    LINK_CUSTOMER: 'link_customer',
    NO_OP: 'no_op',
    MANUAL_REVIEW: 'manual_review'
});

const CHILDREN_REPAIR_ACTIONS = Object.freeze({
    SYNC_CHILDREN: 'sync_children',
    NO_OP: 'no_op',
    MANUAL_REVIEW: 'manual_review'
});

function cleanText(value) {
    const text = String(value ?? '').trim();
    return text || null;
}

function positiveIntegerOrNull(value) {
    const parsed = parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseJsonArray(value) {
    if (Array.isArray(value)) return value;
    if (!value) return [];
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }
    return [];
}

function normalizedContext(value) {
    return normalizeBusinessContext(value) || DEFAULT_BUSINESS_CONTEXT;
}

function sameBusinessContext(left, right) {
    return normalizedContext(left) === normalizedContext(right);
}

function normalizeCelebrants(value, legacy = {}) {
    const items = [];
    for (const item of parseJsonArray(value)) {
        if (!item || typeof item !== 'object') continue;
        const name = cleanText(item.name || item.childName || item.child_name);
        const ageRaw = item.age ?? item.childAge ?? item.child_age;
        const age = ageRaw === undefined || ageRaw === null || ageRaw === ''
            ? null
            : Number(ageRaw);
        const birthday = cleanText(item.birthday || item.birthDate || item.birth_date);
        const notes = cleanText(item.notes || item.note);
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

function safeLeadChildBirthday(value) {
    try {
        return validateChildBirthday(value, 'lead.celebrants[].birthday');
    } catch {
        return null;
    }
}

function leadCustomerChildren(lead = {}) {
    const celebrants = normalizeCelebrants(lead.celebrants, {
        childrenCount: lead.children_count ?? lead.childrenCount,
        childAge: lead.child_age ?? lead.childAge
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

function leadCustomerChildName(lead = {}) {
    const firstChild = leadCustomerChildren(lead).find(item => item.name);
    return firstChild?.name || null;
}

function leadCustomerName(lead = {}) {
    return cleanText(lead.client_name ?? lead.clientName ?? lead.name) || `Lead #${lead.id}`;
}

function leadCustomerSource(lead = {}) {
    return normalizeCustomerSource(lead.source || lead.source_channel || lead.sourceChannel || 'lead', {
        unknownAsNull: false
    });
}

function leadSocialIdentities(lead = {}) {
    const identities = [];
    const instagram = normalizeInstagram(lead.instagram);
    if (instagram) {
        identities.push({ channel: 'instagram', handle: instagram, source: 'lead_repair' });
    }
    const channel = cleanText(lead.source_channel || lead.sourceChannel || lead.source);
    const telegram = cleanText(lead.telegram_id || lead.telegramId);
    const phoneDigits = String(lead.phone || '').replace(/\D/g, '');
    if (channel && channel !== 'instagram') {
        identities.push({
            channel,
            handle: telegram || phoneDigits || cleanText(lead.client_name || lead.clientName),
            source: 'lead_repair'
        });
    }
    return identities.filter(identity => identity.channel && identity.handle);
}

function buildLeadCustomerNotes(lead = {}) {
    const lines = [
        `Lead #${lead.id}`,
        lead.source || lead.source_channel ? `Source: ${[lead.source, lead.source_channel].filter(Boolean).join(' / ')}` : null,
        lead.event_date ? `Desired date: ${lead.event_date}` : null,
        lead.children_count ? `Children count: ${lead.children_count}` : null,
        lead.child_age ? `Child age: ${lead.child_age}` : null,
        lead.notes ? `Lead notes: ${lead.notes}` : null
    ];
    return lines.filter(Boolean).join('\n');
}

function appendUniqueLeadCustomerNote(existingValue, noteValue, leadId) {
    const existing = cleanText(existingValue);
    const note = cleanText(noteValue);
    if (!note) return existing || null;
    if (!existing) return note;
    if (leadId && existing.includes(`Lead #${leadId}`)) return existing;
    if (existing.includes(note)) return existing;
    return `${existing}\n${note}`;
}

async function withTransaction(queryable, work) {
    if (queryable && typeof queryable.connect === 'function') {
        const client = await queryable.connect();
        try {
            await client.query('BEGIN');
            const result = await work(client);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            client.release();
        }
    }
    return work(queryable);
}

async function loadLeadForRepair(queryable, leadId, businessContext) {
    const id = positiveIntegerOrNull(leadId);
    if (!id) return null;
    const context = normalizedContext(businessContext);
    const result = await queryable.query(
        `SELECT *
         FROM leads
         WHERE id = $1
           AND ${normalizedBusinessContextSql('business_context')} = $2
         LIMIT 1`,
        [id, context]
    );
    return result.rows[0] || null;
}

async function loadCustomerForRepair(queryable, customerId, businessContext) {
    const id = positiveIntegerOrNull(customerId);
    if (!id) return null;
    const context = normalizedContext(businessContext);
    const result = await queryable.query(
        `SELECT *
         FROM customers
         WHERE id = $1
           AND ${normalizedBusinessContextSql('business_context')} = $2
         LIMIT 1`,
        [id, context]
    );
    return result.rows[0] || null;
}

async function linkLeadCustomer(queryable, {
    businessContext = DEFAULT_BUSINESS_CONTEXT,
    leadId,
    customerId,
    linkType = 'deal_customer',
    source = 'lead_customer_repair',
    userId = null,
    metadata = {}
} = {}) {
    const normalizedLeadId = positiveIntegerOrNull(leadId);
    const normalizedCustomerId = positiveIntegerOrNull(customerId);
    if (!normalizedLeadId || !normalizedCustomerId) return null;
    const context = normalizedContext(businessContext);
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
            context,
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

function safeSingleCandidate(item = {}) {
    const candidates = Array.isArray(item.candidateCustomers) ? item.candidateCustomers : [];
    const wrongContextCandidates = Array.isArray(item.wrongContextCandidates) ? item.wrongContextCandidates : [];
    if (item.classification !== 'missing_customer_single_candidate') return null;
    if (candidates.length !== 1 || wrongContextCandidates.length > 0) return null;
    const candidate = candidates[0];
    if (!sameBusinessContext(candidate.businessContext, item.businessContext)) return null;
    if (item.checks?.hasWrongBusinessContext || item.checks?.hasBrokenLeadCustomerLink) return null;
    if ((item.checks?.sameContextCandidateCount ?? candidates.length) !== 1) return null;
    return candidate;
}

function planLeadCustomerCardRepairs(auditReport = {}) {
    return (auditReport.results || []).map(item => {
        if (item.classification === 'ok') {
            return {
                action: CARD_REPAIR_ACTIONS.NO_OP,
                leadId: item.leadId,
                businessContext: item.businessContext,
                reason: item.classification
            };
        }

        if (item.classification === 'missing_customer_no_candidate') {
            return {
                action: CARD_REPAIR_ACTIONS.CREATE_CUSTOMER,
                leadId: item.leadId,
                businessContext: item.businessContext,
                reason: item.classification
            };
        }

        const candidate = safeSingleCandidate(item);
        if (candidate) {
            return {
                action: CARD_REPAIR_ACTIONS.LINK_CUSTOMER,
                leadId: item.leadId,
                customerId: candidate.id,
                businessContext: item.businessContext,
                reason: item.classification,
                candidate
            };
        }

        return {
            action: CARD_REPAIR_ACTIONS.MANUAL_REVIEW,
            leadId: item.leadId,
            businessContext: item.businessContext,
            reason: item.classification,
            detail: item.recommendedAction || 'Manual review required'
        };
    });
}

async function createCustomerFromLead(queryable, action, options = {}) {
    const context = normalizedContext(action.businessContext);
    const lead = await loadLeadForRepair(queryable, action.leadId, context);
    if (!lead) {
        return { skipped: true, reason: 'lead_not_found_or_context_mismatch' };
    }
    if (!sameBusinessContext(lead.business_context || context, context)) {
        return { skipped: true, reason: 'lead_context_mismatch' };
    }

    const leadId = positiveIntegerOrNull(lead.id);
    const noteBlock = buildLeadCustomerNotes(lead);
    const inserted = await queryable.query(
        `INSERT INTO customers (business_context, name, phone, instagram, child_name, source, notes, lead_id, social_identities)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
         RETURNING *`,
        [
            context,
            leadCustomerName(lead),
            cleanText(lead.phone),
            normalizeInstagram(lead.instagram) || null,
            leadCustomerChildName(lead),
            leadCustomerSource(lead),
            noteBlock || null,
            leadId,
            JSON.stringify(leadSocialIdentities(lead))
        ]
    );
    const customer = inserted.rows[0];
    const link = await linkLeadCustomer(queryable, {
        businessContext: context,
        leadId,
        customerId: customer?.id,
        linkType: options.linkType || 'deal_customer',
        source: options.source || 'lead_customer_repair',
        userId: options.userId || null,
        metadata: { mode: 'created_new', repair: 'lead_customer_cards' }
    });
    return {
        mode: 'created_new',
        customerId: customer?.id || null,
        leadId,
        businessContext: context,
        linkId: link?.id || null
    };
}

async function linkSingleCandidate(queryable, action, options = {}) {
    const context = normalizedContext(action.businessContext);
    const lead = await loadLeadForRepair(queryable, action.leadId, context);
    if (!lead) {
        return { skipped: true, reason: 'lead_not_found_or_context_mismatch' };
    }
    const customer = await loadCustomerForRepair(queryable, action.customerId, context);
    if (!customer) {
        return { skipped: true, reason: 'customer_not_found_or_context_mismatch' };
    }
    if (!sameBusinessContext(lead.business_context || context, context) || !sameBusinessContext(customer.business_context || context, context)) {
        return { skipped: true, reason: 'context_mismatch' };
    }

    const leadId = positiveIntegerOrNull(lead.id);
    const customerId = positiveIntegerOrNull(customer.id);
    const notes = appendUniqueLeadCustomerNote(customer.notes, buildLeadCustomerNotes(lead), leadId);
    await queryable.query(
        `UPDATE customers
         SET name = COALESCE(NULLIF(name, ''), $1),
             phone = COALESCE(NULLIF(phone, ''), $2),
             instagram = COALESCE(NULLIF(instagram, ''), $3),
             child_name = COALESCE(NULLIF(child_name, ''), $4),
             source = COALESCE(NULLIF(source, ''), $5),
             notes = $6,
             lead_id = CASE WHEN lead_id IS NULL OR lead_id = $7 THEN $7 ELSE lead_id END,
             social_identities = CASE
                 WHEN social_identities IS NULL OR social_identities = '[]'::jsonb THEN $8::jsonb
                 ELSE social_identities
             END,
             updated_at = NOW()
         WHERE id = $9
           AND ${normalizedBusinessContextSql('business_context')} = $10
         RETURNING *`,
        [
            leadCustomerName(lead),
            cleanText(lead.phone),
            normalizeInstagram(lead.instagram) || null,
            leadCustomerChildName(lead),
            leadCustomerSource(lead),
            notes,
            leadId,
            JSON.stringify(leadSocialIdentities(lead)),
            customerId,
            context
        ]
    );
    const link = await linkLeadCustomer(queryable, {
        businessContext: context,
        leadId,
        customerId,
        linkType: options.linkType || 'deal_customer',
        source: options.source || 'lead_customer_repair',
        userId: options.userId || null,
        metadata: { mode: 'linked_existing', repair: 'lead_customer_cards' }
    });
    return {
        mode: 'linked_existing',
        customerId,
        leadId,
        businessContext: context,
        linkId: link?.id || null
    };
}

async function repairLeadCustomerCards(queryable, options = {}) {
    const dryRun = options.apply === true ? false : options.dryRun !== false;
    const auditReport = options.auditReport || await auditLeadCustomerCards(queryable, options);
    const actions = planLeadCustomerCardRepairs(auditReport);
    const manualReview = actions.filter(action => action.action === CARD_REPAIR_ACTIONS.MANUAL_REVIEW);
    const safeActions = actions.filter(action =>
        action.action === CARD_REPAIR_ACTIONS.CREATE_CUSTOMER
        || action.action === CARD_REPAIR_ACTIONS.LINK_CUSTOMER
    );
    const report = {
        mode: dryRun ? 'dry-run' : 'apply',
        scanned: auditReport.scanned || 0,
        plannedCount: safeActions.length,
        repairedCount: 0,
        skippedCount: manualReview.length,
        manualReviewCount: manualReview.length,
        actions,
        repaired: [],
        skipped: [...manualReview],
        manualReview,
        audit: {
            classifications: auditReport.classifications || {},
            issueCount: auditReport.issueCount || 0
        }
    };

    if (dryRun) return report;

    for (const action of safeActions) {
        try {
            const result = await withTransaction(queryable, client => {
                if (action.action === CARD_REPAIR_ACTIONS.CREATE_CUSTOMER) {
                    return createCustomerFromLead(client, action, options);
                }
                if (action.action === CARD_REPAIR_ACTIONS.LINK_CUSTOMER) {
                    return linkSingleCandidate(client, action, options);
                }
                return { skipped: true, reason: 'unsupported_action' };
            });
            if (result?.skipped) {
                report.skipped.push({ ...action, reason: result.reason });
                report.skippedCount += 1;
            } else {
                report.repaired.push({ ...action, result });
                report.repairedCount += 1;
            }
        } catch (error) {
            report.skipped.push({ ...action, reason: 'repair_failed', error: error.message });
            report.skippedCount += 1;
        }
    }

    return report;
}

function planLeadCustomerChildrenRepairs(auditReport = {}) {
    return (auditReport.results || []).map(item => {
        if (item.classification === 'ok') {
            return {
                action: CHILDREN_REPAIR_ACTIONS.NO_OP,
                leadId: item.leadId,
                customerId: item.customerId || null,
                businessContext: item.businessContext,
                reason: item.classification
            };
        }

        if (item.classification === 'missing_customer_child' && positiveIntegerOrNull(item.customerId)) {
            return {
                action: CHILDREN_REPAIR_ACTIONS.SYNC_CHILDREN,
                leadId: item.leadId,
                customerId: item.customerId,
                businessContext: item.businessContext,
                reason: item.classification,
                missingChildCount: item.missingChildCount
            };
        }
        return {
            action: CHILDREN_REPAIR_ACTIONS.MANUAL_REVIEW,
            leadId: item.leadId,
            customerId: item.customerId || null,
            businessContext: item.businessContext,
            reason: item.classification,
            detail: item.classification === 'missing_customer_link'
                ? 'Customer link must be repaired by Audit A before children sync'
                : 'No children sync repair required'
        };
    });
}

async function syncLeadCelebrantsToCustomerChildren(queryable, lead = {}, customer = null, businessContext = DEFAULT_BUSINESS_CONTEXT) {
    const leadId = positiveIntegerOrNull(lead.id);
    const customerId = positiveIntegerOrNull(customer?.id);
    if (!leadId || !customerId) {
        return { customer, children: [] };
    }

    const context = normalizedContext(businessContext);
    if (!sameBusinessContext(lead.business_context || context, context) || !sameBusinessContext(customer.business_context || context, context)) {
        return { customer, children: [], skipped: true, reason: 'context_mismatch' };
    }

    const children = leadCustomerChildren(lead);
    const rawCelebrants = parseJsonArray(lead.celebrants);
    const legacyChildSnapshot = buildLegacyChildSnapshot(children, {
        childName: leadCustomerChildName(lead)
    });
    const savedChildren = await replaceCustomerChildren(
        customerId,
        children,
        context,
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
           AND ${normalizedBusinessContextSql('business_context')} = $3
         RETURNING *`,
        [legacyChildSnapshot.childName || null, customerId, context, leadId]
    );
    const nextCustomer = updated.rows[0] || customer;
    nextCustomer.children = buildCustomerChildrenProjection(nextCustomer, savedChildren);
    return { customer: nextCustomer, children: savedChildren };
}

async function repairLeadCustomerChildren(queryable, options = {}) {
    const dryRun = options.apply === true ? false : options.dryRun !== false;
    const auditReport = options.auditReport || await auditLeadCustomerChildrenSync(queryable, options);
    const actions = planLeadCustomerChildrenRepairs(auditReport);
    const manualReview = actions.filter(action => action.action === CHILDREN_REPAIR_ACTIONS.MANUAL_REVIEW && action.reason !== 'ok');
    const safeActions = actions.filter(action => action.action === CHILDREN_REPAIR_ACTIONS.SYNC_CHILDREN);
    const report = {
        mode: dryRun ? 'dry-run' : 'apply',
        scanned: auditReport.scanned || 0,
        plannedCount: safeActions.length,
        repairedCount: 0,
        skippedCount: manualReview.length,
        manualReviewCount: manualReview.length,
        actions,
        repaired: [],
        skipped: [...manualReview],
        manualReview,
        audit: {
            byClassification: auditReport.byClassification || {},
            issueCount: auditReport.issueCount || 0
        }
    };

    if (dryRun) return report;

    for (const action of safeActions) {
        try {
            const result = await withTransaction(queryable, async client => {
                const context = normalizedContext(action.businessContext);
                const lead = await loadLeadForRepair(client, action.leadId, context);
                if (!lead) return { skipped: true, reason: 'lead_not_found_or_context_mismatch' };
                const customer = await loadCustomerForRepair(client, action.customerId, context);
                if (!customer) return { skipped: true, reason: 'customer_not_found_or_context_mismatch' };
                return syncLeadCelebrantsToCustomerChildren(client, lead, customer, context);
            });
            if (result?.skipped) {
                report.skipped.push({ ...action, reason: result.reason });
                report.skippedCount += 1;
            } else {
                report.repaired.push({
                    ...action,
                    result: {
                        leadId: action.leadId,
                        customerId: action.customerId,
                        syncedChildren: result?.children?.length || 0
                    }
                });
                report.repairedCount += 1;
            }
        } catch (error) {
            report.skipped.push({ ...action, reason: 'repair_failed', error: error.message });
            report.skippedCount += 1;
        }
    }

    return report;
}

module.exports = {
    CARD_REPAIR_ACTIONS,
    CHILDREN_REPAIR_ACTIONS,
    appendUniqueLeadCustomerNote,
    leadCustomerChildren,
    planLeadCustomerCardRepairs,
    planLeadCustomerChildrenRepairs,
    repairLeadCustomerCards,
    repairLeadCustomerChildren,
    syncLeadCelebrantsToCustomerChildren
};

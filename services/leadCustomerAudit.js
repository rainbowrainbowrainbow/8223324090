'use strict';

const {
    DEFAULT_BUSINESS_CONTEXT,
    normalizeBusinessContext
} = require('./businessContext');

const CUSTOMER_CARD_PIPELINE_STAGES = Object.freeze([
    'deal',
    'deposit_received',
    'waiting',
    'completed',
    'closed'
]);

const AUDIT_CLASSIFICATIONS = Object.freeze([
    'ok',
    'missing_customer_no_candidate',
    'missing_customer_single_candidate',
    'missing_customer_ambiguous_candidates',
    'wrong_business_context',
    'broken_link_customer_missing'
]);

function normalizeDigits(value) {
    return String(value || '').replace(/\D/g, '');
}

function normalizeInstagram(value) {
    return String(value || '').trim().replace(/^@+/, '').toLowerCase();
}

function toPositiveInteger(value) {
    const parsed = parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function toCount(value) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
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

function normalizedBusinessContextSql(column) {
    const normalized = `LOWER(COALESCE(NULLIF(BTRIM(${column}), ''), '${DEFAULT_BUSINESS_CONTEXT}'))`;
    return `(CASE
        WHEN ${normalized} IN ('park_zakrevsky', 'park', 'pzp') THEN '${DEFAULT_BUSINESS_CONTEXT}'
        WHEN ${normalized} IN ('maysternya', 'md') THEN 'maysternya_doli'
        WHEN ${normalized} IN ('crm_sales', 'sales_crm') THEN 'crm'
        ELSE ${normalized}
    END)`;
}

function normalizedInstagramSql(column) {
    return `LOWER(REGEXP_REPLACE(BTRIM(COALESCE(${column}, '')), '^@+', '', 'g'))`;
}

function effectiveLeadStageSql(alias = 'l') {
    return `(CASE
        WHEN NULLIF(BTRIM(${alias}.pipeline_stage), '') IS NOT NULL THEN BTRIM(${alias}.pipeline_stage)
        WHEN COALESCE(${alias}.status, '') = 'booked' THEN 'deposit_received'
        WHEN COALESCE(${alias}.status, '') = 'proposal' THEN 'deal'
        WHEN COALESCE(${alias}.status, '') = 'completed' THEN 'completed'
        WHEN COALESCE(${alias}.status, '') = 'lost' THEN 'lost'
        WHEN COALESCE(${alias}.status, '') = 'contact' THEN 'contacted'
        ELSE COALESCE(NULLIF(BTRIM(${alias}.status), ''), 'new')
    END)`;
}

function buildLeadCustomerAuditQuery(options = {}) {
    const stages = Array.isArray(options.stages) && options.stages.length
        ? options.stages.map(stage => String(stage || '').trim()).filter(Boolean)
        : [...CUSTOMER_CARD_PIPELINE_STAGES];
    const params = [stages];
    const filters = [`${effectiveLeadStageSql('l')} = ANY($1::text[])`];
    const leadContext = normalizedBusinessContextSql('l.business_context');
    const directCustomerContext = normalizedBusinessContextSql('c.business_context');
    const linkContext = normalizedBusinessContextSql('lcl.business_context');
    const linkCustomerContext = normalizedBusinessContextSql('c.business_context');
    const phoneCustomerContext = normalizedBusinessContextSql('c.business_context');
    const instagramCustomerContext = normalizedBusinessContextSql('c.business_context');

    if (options.businessContext) {
        params.push(normalizeBusinessContext(options.businessContext));
        filters.push(`${leadContext} = $${params.length}`);
    }

    const leadId = toPositiveInteger(options.leadId);
    if (leadId) {
        params.push(leadId);
        filters.push('l.id = $' + params.length);
    }

    const limit = toPositiveInteger(options.limit);
    const limitSql = limit ? `LIMIT ${limit}` : '';

    const sql = `
WITH target_leads AS (
    SELECT
        l.id AS lead_id,
        ${leadContext} AS business_context,
        l.business_context AS raw_business_context,
        l.client_name,
        l.phone,
        l.instagram,
        REGEXP_REPLACE(COALESCE(l.phone, ''), '\\D', '', 'g') AS phone_digits,
        ${normalizedInstagramSql('l.instagram')} AS instagram_key,
        ${effectiveLeadStageSql('l')} AS pipeline_stage,
        l.status,
        l.created_at,
        l.updated_at
    FROM leads l
    WHERE ${filters.join('\n      AND ')}
    ORDER BY l.updated_at DESC NULLS LAST, l.created_at DESC NULLS LAST, l.id DESC
    ${limitSql}
),
direct_customers AS (
    SELECT
        tl.lead_id,
        COUNT(DISTINCT c.id) FILTER (WHERE c.id IS NOT NULL AND ${directCustomerContext} = tl.business_context) AS direct_customer_count,
        COUNT(DISTINCT c.id) FILTER (WHERE c.id IS NOT NULL AND ${directCustomerContext} <> tl.business_context) AS direct_wrong_context_count,
        JSONB_AGG(DISTINCT JSONB_BUILD_OBJECT(
            'id', c.id,
            'name', c.name,
            'phone', c.phone,
            'instagram', c.instagram,
            'businessContext', ${directCustomerContext},
            'rawBusinessContext', c.business_context,
            'leadId', c.lead_id,
            'match', 'customers.lead_id'
        )) FILTER (WHERE c.id IS NOT NULL AND ${directCustomerContext} = tl.business_context) AS customers_by_lead_id,
        JSONB_AGG(DISTINCT JSONB_BUILD_OBJECT(
            'id', c.id,
            'name', c.name,
            'phone', c.phone,
            'instagram', c.instagram,
            'businessContext', ${directCustomerContext},
            'rawBusinessContext', c.business_context,
            'leadId', c.lead_id,
            'match', 'customers.lead_id'
        )) FILTER (WHERE c.id IS NOT NULL AND ${directCustomerContext} <> tl.business_context) AS direct_wrong_context_customers
    FROM target_leads tl
    LEFT JOIN customers c ON c.lead_id = tl.lead_id
    GROUP BY tl.lead_id
),
linked_customers AS (
    SELECT
        tl.lead_id,
        COUNT(DISTINCT c.id) FILTER (
            WHERE lcl.id IS NOT NULL
              AND c.id IS NOT NULL
              AND ${linkContext} = tl.business_context
              AND ${linkCustomerContext} = tl.business_context
        ) AS linked_customer_count,
        COUNT(DISTINCT lcl.id) FILTER (WHERE lcl.id IS NOT NULL AND c.id IS NULL) AS broken_link_count,
        COUNT(DISTINCT lcl.id) FILTER (
            WHERE lcl.id IS NOT NULL
              AND c.id IS NOT NULL
              AND (${linkContext} <> tl.business_context OR ${linkCustomerContext} <> tl.business_context)
        ) AS linked_wrong_context_count,
        JSONB_AGG(DISTINCT JSONB_BUILD_OBJECT(
            'id', c.id,
            'name', c.name,
            'phone', c.phone,
            'instagram', c.instagram,
            'businessContext', ${linkCustomerContext},
            'rawBusinessContext', c.business_context,
            'leadId', c.lead_id,
            'linkId', lcl.id,
            'linkBusinessContext', ${linkContext},
            'rawLinkBusinessContext', lcl.business_context,
            'linkType', lcl.link_type,
            'source', lcl.source,
            'match', 'lead_customer_links'
        )) FILTER (
            WHERE lcl.id IS NOT NULL
              AND c.id IS NOT NULL
              AND ${linkContext} = tl.business_context
              AND ${linkCustomerContext} = tl.business_context
        ) AS linked_customers,
        JSONB_AGG(DISTINCT JSONB_BUILD_OBJECT(
            'linkId', lcl.id,
            'leadId', lcl.lead_id,
            'customerId', lcl.customer_id,
            'linkBusinessContext', ${linkContext},
            'rawLinkBusinessContext', lcl.business_context,
            'linkType', lcl.link_type,
            'source', lcl.source,
            'match', 'lead_customer_links'
        )) FILTER (WHERE lcl.id IS NOT NULL AND c.id IS NULL) AS broken_links,
        JSONB_AGG(DISTINCT JSONB_BUILD_OBJECT(
            'id', c.id,
            'name', c.name,
            'phone', c.phone,
            'instagram', c.instagram,
            'businessContext', ${linkCustomerContext},
            'rawBusinessContext', c.business_context,
            'leadId', c.lead_id,
            'linkId', lcl.id,
            'linkBusinessContext', ${linkContext},
            'rawLinkBusinessContext', lcl.business_context,
            'linkType', lcl.link_type,
            'source', lcl.source,
            'match', 'lead_customer_links'
        )) FILTER (
            WHERE lcl.id IS NOT NULL
              AND c.id IS NOT NULL
              AND (${linkContext} <> tl.business_context OR ${linkCustomerContext} <> tl.business_context)
        ) AS linked_wrong_context_customers
    FROM target_leads tl
    LEFT JOIN lead_customer_links lcl ON lcl.lead_id = tl.lead_id
    LEFT JOIN customers c ON c.id = lcl.customer_id
    GROUP BY tl.lead_id
),
phone_candidates AS (
    SELECT
        tl.lead_id,
        COUNT(DISTINCT c.id) FILTER (WHERE c.id IS NOT NULL AND ${phoneCustomerContext} = tl.business_context) AS phone_candidate_count,
        COUNT(DISTINCT c.id) FILTER (WHERE c.id IS NOT NULL AND ${phoneCustomerContext} <> tl.business_context) AS phone_wrong_context_count,
        JSONB_AGG(DISTINCT JSONB_BUILD_OBJECT(
            'id', c.id,
            'name', c.name,
            'phone', c.phone,
            'instagram', c.instagram,
            'businessContext', ${phoneCustomerContext},
            'rawBusinessContext', c.business_context,
            'leadId', c.lead_id,
            'match', 'phone'
        )) FILTER (WHERE c.id IS NOT NULL AND ${phoneCustomerContext} = tl.business_context) AS phone_candidates,
        JSONB_AGG(DISTINCT JSONB_BUILD_OBJECT(
            'id', c.id,
            'name', c.name,
            'phone', c.phone,
            'instagram', c.instagram,
            'businessContext', ${phoneCustomerContext},
            'rawBusinessContext', c.business_context,
            'leadId', c.lead_id,
            'match', 'phone'
        )) FILTER (WHERE c.id IS NOT NULL AND ${phoneCustomerContext} <> tl.business_context) AS phone_wrong_context_candidates
    FROM target_leads tl
    LEFT JOIN customers c
      ON tl.phone_digits <> ''
     AND REGEXP_REPLACE(COALESCE(c.phone, ''), '\\D', '', 'g') = tl.phone_digits
    GROUP BY tl.lead_id
),
instagram_candidates AS (
    SELECT
        tl.lead_id,
        COUNT(DISTINCT c.id) FILTER (WHERE c.id IS NOT NULL AND ${instagramCustomerContext} = tl.business_context) AS instagram_candidate_count,
        COUNT(DISTINCT c.id) FILTER (WHERE c.id IS NOT NULL AND ${instagramCustomerContext} <> tl.business_context) AS instagram_wrong_context_count,
        JSONB_AGG(DISTINCT JSONB_BUILD_OBJECT(
            'id', c.id,
            'name', c.name,
            'phone', c.phone,
            'instagram', c.instagram,
            'businessContext', ${instagramCustomerContext},
            'rawBusinessContext', c.business_context,
            'leadId', c.lead_id,
            'match', 'instagram'
        )) FILTER (WHERE c.id IS NOT NULL AND ${instagramCustomerContext} = tl.business_context) AS instagram_candidates,
        JSONB_AGG(DISTINCT JSONB_BUILD_OBJECT(
            'id', c.id,
            'name', c.name,
            'phone', c.phone,
            'instagram', c.instagram,
            'businessContext', ${instagramCustomerContext},
            'rawBusinessContext', c.business_context,
            'leadId', c.lead_id,
            'match', 'instagram'
        )) FILTER (WHERE c.id IS NOT NULL AND ${instagramCustomerContext} <> tl.business_context) AS instagram_wrong_context_candidates
    FROM target_leads tl
    LEFT JOIN customers c
      ON tl.instagram_key <> ''
     AND ${normalizedInstagramSql('c.instagram')} = tl.instagram_key
    GROUP BY tl.lead_id
)
SELECT
    tl.*,
    COALESCE(dc.direct_customer_count, 0) AS direct_customer_count,
    COALESCE(dc.direct_wrong_context_count, 0) AS direct_wrong_context_count,
    COALESCE(dc.customers_by_lead_id, '[]'::jsonb) AS customers_by_lead_id,
    COALESCE(dc.direct_wrong_context_customers, '[]'::jsonb) AS direct_wrong_context_customers,
    COALESCE(lc.linked_customer_count, 0) AS linked_customer_count,
    COALESCE(lc.broken_link_count, 0) AS broken_link_count,
    COALESCE(lc.linked_wrong_context_count, 0) AS linked_wrong_context_count,
    COALESCE(lc.linked_customers, '[]'::jsonb) AS linked_customers,
    COALESCE(lc.broken_links, '[]'::jsonb) AS broken_links,
    COALESCE(lc.linked_wrong_context_customers, '[]'::jsonb) AS linked_wrong_context_customers,
    COALESCE(pc.phone_candidate_count, 0) AS phone_candidate_count,
    COALESCE(pc.phone_wrong_context_count, 0) AS phone_wrong_context_count,
    COALESCE(pc.phone_candidates, '[]'::jsonb) AS phone_candidates,
    COALESCE(pc.phone_wrong_context_candidates, '[]'::jsonb) AS phone_wrong_context_candidates,
    COALESCE(ic.instagram_candidate_count, 0) AS instagram_candidate_count,
    COALESCE(ic.instagram_wrong_context_count, 0) AS instagram_wrong_context_count,
    COALESCE(ic.instagram_candidates, '[]'::jsonb) AS instagram_candidates,
    COALESCE(ic.instagram_wrong_context_candidates, '[]'::jsonb) AS instagram_wrong_context_candidates
FROM target_leads tl
LEFT JOIN direct_customers dc ON dc.lead_id = tl.lead_id
LEFT JOIN linked_customers lc ON lc.lead_id = tl.lead_id
LEFT JOIN phone_candidates pc ON pc.lead_id = tl.lead_id
LEFT JOIN instagram_candidates ic ON ic.lead_id = tl.lead_id
ORDER BY tl.updated_at DESC NULLS LAST, tl.created_at DESC NULLS LAST, tl.lead_id DESC`;

    return { sql, params };
}

function mergeCandidate(existing, item) {
    const matches = new Set(Array.isArray(existing.matches) ? existing.matches : []);
    if (existing.match) matches.add(existing.match);
    if (item.match) matches.add(item.match);
    if (Array.isArray(item.matches)) item.matches.filter(Boolean).forEach(match => matches.add(match));
    existing.matches = Array.from(matches);
    return existing;
}

function dedupeCustomers(items) {
    const byId = new Map();
    for (const item of items || []) {
        if (!item || item.id === null || item.id === undefined) continue;
        const key = String(item.id);
        if (byId.has(key)) {
            mergeCandidate(byId.get(key), item);
            continue;
        }
        const copy = { ...item };
        copy.matches = Array.isArray(copy.matches)
            ? copy.matches.filter(Boolean)
            : [copy.match].filter(Boolean);
        byId.set(key, copy);
    }
    return Array.from(byId.values());
}

function recommendedActionFor(classification) {
    switch (classification) {
        case 'broken_link_customer_missing':
            return 'Inspect the stale lead_customer_links row, recreate the missing customer if needed, then relink.';
        case 'wrong_business_context':
            return 'Verify tenant ownership, then move or relink the customer in the lead business_context.';
        case 'missing_customer_no_candidate':
            return 'Create a customer card from the lead in the same business_context.';
        case 'missing_customer_single_candidate':
            return 'Review and link the single candidate customer to the lead.';
        case 'missing_customer_ambiguous_candidates':
            return 'Review candidates manually before linking; do not auto-merge.';
        case 'ok':
        default:
            return 'No customer-card repair required.';
    }
}

function buildLeadCustomerAuditResult(row = {}) {
    const customersByLeadId = parseJsonArray(row.customers_by_lead_id || row.customersByLeadId);
    const linkedCustomers = parseJsonArray(row.linked_customers || row.linkedCustomers);
    const brokenLinks = parseJsonArray(row.broken_links || row.brokenLinks);
    const phoneCandidates = parseJsonArray(row.phone_candidates || row.phoneCandidates);
    const instagramCandidates = parseJsonArray(row.instagram_candidates || row.instagramCandidates);
    const directWrongContextCustomers = parseJsonArray(row.direct_wrong_context_customers || row.directWrongContextCustomers);
    const linkedWrongContextCustomers = parseJsonArray(row.linked_wrong_context_customers || row.linkedWrongContextCustomers);
    const phoneWrongContextCandidates = parseJsonArray(row.phone_wrong_context_candidates || row.phoneWrongContextCandidates);
    const instagramWrongContextCandidates = parseJsonArray(row.instagram_wrong_context_candidates || row.instagramWrongContextCandidates);
    const sameContextCandidates = dedupeCustomers([...phoneCandidates, ...instagramCandidates]);
    const wrongContextCandidates = dedupeCustomers([
        ...directWrongContextCustomers,
        ...linkedWrongContextCustomers,
        ...phoneWrongContextCandidates,
        ...instagramWrongContextCandidates
    ]);

    const directCustomerCount = toCount(row.direct_customer_count ?? row.directCustomerCount ?? customersByLeadId.length);
    const linkedCustomerCount = toCount(row.linked_customer_count ?? row.linkedCustomerCount ?? linkedCustomers.length);
    const directWrongContextCount = toCount(row.direct_wrong_context_count ?? row.directWrongContextCount ?? directWrongContextCustomers.length);
    const linkedWrongContextCount = toCount(row.linked_wrong_context_count ?? row.linkedWrongContextCount ?? linkedWrongContextCustomers.length);
    const brokenLinkCount = toCount(row.broken_link_count ?? row.brokenLinkCount ?? brokenLinks.length);
    const phoneWrongContextCount = toCount(row.phone_wrong_context_count ?? row.phoneWrongContextCount ?? phoneWrongContextCandidates.length);
    const instagramWrongContextCount = toCount(row.instagram_wrong_context_count ?? row.instagramWrongContextCount ?? instagramWrongContextCandidates.length);

    const hasExpectedCustomer = directCustomerCount > 0 || linkedCustomerCount > 0;
    const hasExplicitWrongContext = directWrongContextCount > 0 || linkedWrongContextCount > 0;
    const hasWrongContextCandidatesOnly = !hasExpectedCustomer
        && sameContextCandidates.length === 0
        && (phoneWrongContextCount > 0 || instagramWrongContextCount > 0 || wrongContextCandidates.length > 0);

    let classification = 'missing_customer_no_candidate';
    if (brokenLinkCount > 0 || brokenLinks.length > 0) {
        classification = 'broken_link_customer_missing';
    } else if (hasExplicitWrongContext || hasWrongContextCandidatesOnly) {
        classification = 'wrong_business_context';
    } else if (hasExpectedCustomer) {
        classification = 'ok';
    } else if (sameContextCandidates.length === 1) {
        classification = 'missing_customer_single_candidate';
    } else if (sameContextCandidates.length > 1) {
        classification = 'missing_customer_ambiguous_candidates';
    }

    return {
        leadId: row.lead_id ?? row.leadId ?? null,
        businessContext: row.business_context || row.businessContext || DEFAULT_BUSINESS_CONTEXT,
        rawBusinessContext: row.raw_business_context || row.rawBusinessContext || null,
        pipelineStage: row.pipeline_stage || row.pipelineStage || null,
        status: row.status || null,
        clientName: row.client_name || row.clientName || null,
        phone: row.phone || null,
        instagram: row.instagram || null,
        normalizedPhone: row.phone_digits || row.normalizedPhone || normalizeDigits(row.phone),
        normalizedInstagram: row.instagram_key || row.normalizedInstagram || normalizeInstagram(row.instagram),
        classification,
        recommendedAction: recommendedActionFor(classification),
        checks: {
            hasCustomerLeadId: directCustomerCount > 0,
            hasLeadCustomerLink: linkedCustomerCount > 0,
            hasBrokenLeadCustomerLink: brokenLinkCount > 0 || brokenLinks.length > 0,
            hasWrongBusinessContext: hasExplicitWrongContext || hasWrongContextCandidatesOnly,
            sameContextCandidateCount: sameContextCandidates.length,
            wrongContextCandidateCount: wrongContextCandidates.length,
            directCustomerCount,
            linkedCustomerCount,
            brokenLinkCount,
            directWrongContextCount,
            linkedWrongContextCount,
            phoneCandidateCount: toCount(row.phone_candidate_count ?? row.phoneCandidateCount ?? phoneCandidates.length),
            instagramCandidateCount: toCount(row.instagram_candidate_count ?? row.instagramCandidateCount ?? instagramCandidates.length),
            phoneWrongContextCount,
            instagramWrongContextCount
        },
        customersByLeadId,
        linkedCustomers,
        phoneCandidates,
        instagramCandidates,
        candidateCustomers: sameContextCandidates,
        wrongContextCandidates,
        brokenLinks
    };
}

function classifyLeadCustomerAuditRow(row = {}) {
    return buildLeadCustomerAuditResult(row).classification;
}

function countClassifications(results) {
    const counts = Object.fromEntries(AUDIT_CLASSIFICATIONS.map(key => [key, 0]));
    for (const result of results) {
        if (!Object.prototype.hasOwnProperty.call(counts, result.classification)) {
            counts[result.classification] = 0;
        }
        counts[result.classification] += 1;
    }
    return counts;
}

async function auditLeadCustomerCards(queryable, options = {}) {
    if (!queryable || typeof queryable.query !== 'function') {
        throw new Error('A queryable client or pool is required');
    }
    const { sql, params } = buildLeadCustomerAuditQuery(options);
    const result = await queryable.query(sql, params);
    const results = (result.rows || []).map(buildLeadCustomerAuditResult);
    const classifications = countClassifications(results);
    return {
        scanned: results.length,
        classifications,
        issueCount: results.filter(item => item.classification !== 'ok').length,
        options: {
            stages: Array.isArray(options.stages) && options.stages.length
                ? options.stages
                : [...CUSTOMER_CARD_PIPELINE_STAGES],
            businessContext: options.businessContext ? normalizeBusinessContext(options.businessContext) : null,
            leadId: toPositiveInteger(options.leadId),
            limit: toPositiveInteger(options.limit)
        },
        results
    };
}

module.exports = {
    AUDIT_CLASSIFICATIONS,
    CUSTOMER_CARD_PIPELINE_STAGES,
    auditLeadCustomerCards,
    buildLeadCustomerAuditQuery,
    buildLeadCustomerAuditResult,
    classifyLeadCustomerAuditRow,
    effectiveLeadStageSql,
    normalizeDigits,
    normalizeInstagram,
    normalizedBusinessContextSql,
    normalizedInstagramSql
};

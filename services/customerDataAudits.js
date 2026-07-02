'use strict';

const { buildCustomerSearchQuery } = require('./customerSearchQuery');
const {
    CUSTOMER_CARD_PIPELINE_STAGES,
    effectiveLeadStageSql,
    normalizeDigits,
    normalizeInstagram,
    normalizedBusinessContextSql,
    normalizedInstagramSql
} = require('./leadCustomerAudit');
const {
    DEFAULT_BUSINESS_CONTEXT,
    normalizeBusinessContext
} = require('./businessContext');

function toPositiveInteger(value) {
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

function cleanText(value) {
    const text = String(value || '').trim();
    return text || null;
}

function customerNamePrefix(name, length = 4) {
    const firstToken = cleanText(name)?.split(/\s+/)[0] || '';
    if (firstToken.length < 2) return null;
    return firstToken.slice(0, Math.max(2, length));
}

function buildCustomerSearchabilityTargetQuery(options = {}) {
    const stages = Array.isArray(options.stages) && options.stages.length
        ? options.stages.map(stage => String(stage || '').trim()).filter(Boolean)
        : [...CUSTOMER_CARD_PIPELINE_STAGES];
    const params = [stages];
    const leadContext = normalizedBusinessContextSql('l.business_context');
    const customerContext = normalizedBusinessContextSql('c.business_context');
    const linkContext = normalizedBusinessContextSql('lcl.business_context');
    const filters = [`${effectiveLeadStageSql('l')} = ANY($1::text[])`];

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
    const includeCandidates = options.includeCandidates === true;
    const phoneCustomerContext = normalizedBusinessContextSql('c.business_context');
    const instagramCustomerContext = normalizedBusinessContextSql('c.business_context');
    const candidateUnionSql = includeCandidates ? `
    UNION ALL
    SELECT DISTINCT tl.business_context, tl.lead_id, c.id AS customer_id, 'phone_candidate' AS source_kind
    FROM target_leads tl
    JOIN customers c
      ON tl.phone_digits <> ''
     AND REGEXP_REPLACE(COALESCE(c.phone, ''), '\\D', '', 'g') = tl.phone_digits
     AND ${phoneCustomerContext} = tl.business_context
    UNION ALL
    SELECT DISTINCT tl.business_context, tl.lead_id, c.id AS customer_id, 'instagram_candidate' AS source_kind
    FROM target_leads tl
    JOIN customers c
      ON tl.instagram_key <> ''
     AND ${normalizedInstagramSql('c.instagram')} = tl.instagram_key
     AND ${instagramCustomerContext} = tl.business_context` : '';

    const sql = `
WITH target_leads AS (
    SELECT
        l.id AS lead_id,
        ${leadContext} AS business_context,
        l.client_name,
        l.phone AS lead_phone,
        l.instagram AS lead_instagram,
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
raw_targets AS (
    SELECT DISTINCT tl.business_context, tl.lead_id, c.id AS customer_id, 'customers.lead_id' AS source_kind
    FROM target_leads tl
    JOIN customers c
      ON c.lead_id = tl.lead_id
     AND ${customerContext} = tl.business_context
    UNION ALL
    SELECT DISTINCT tl.business_context, tl.lead_id, c.id AS customer_id, 'lead_customer_links' AS source_kind
    FROM target_leads tl
    JOIN lead_customer_links lcl
      ON lcl.lead_id = tl.lead_id
     AND ${linkContext} = tl.business_context
    JOIN customers c
      ON c.id = lcl.customer_id
     AND ${customerContext} = tl.business_context
    ${candidateUnionSql}
)
SELECT
    rt.business_context,
    rt.lead_id,
    c.id AS customer_id,
    c.name,
    c.phone,
    c.instagram,
    c.child_name,
    c.child_birthday,
    child.name AS canonical_child_name,
    ARRAY_AGG(DISTINCT rt.source_kind ORDER BY rt.source_kind) AS source_kinds
FROM raw_targets rt
JOIN customers c ON c.id = rt.customer_id
LEFT JOIN LATERAL (
    SELECT cc.name
    FROM customer_children cc
    WHERE cc.customer_id = c.id
      AND cc.business_context = rt.business_context
      AND NULLIF(BTRIM(cc.name), '') IS NOT NULL
    ORDER BY cc.sort_order ASC NULLS LAST, cc.id ASC
    LIMIT 1
) child ON true
GROUP BY rt.business_context, rt.lead_id, c.id, c.name, c.phone, c.instagram, c.child_name, c.child_birthday, child.name
ORDER BY rt.business_context, rt.lead_id, c.id`;

    return { sql, params };
}

function buildSearchabilityTerms(target, options = {}) {
    const terms = [];
    const prefix = customerNamePrefix(target.name, options.namePrefixLength || 4);
    if (prefix) {
        terms.push({ type: 'name_prefix', query: prefix, value: target.name || null });
    }
    const phoneDigits = normalizeDigits(target.phone);
    if (phoneDigits.length >= 2) {
        terms.push({ type: 'phone_digits', query: phoneDigits, value: target.phone || null });
    }
    const instagram = normalizeInstagram(target.instagram);
    if (instagram) {
        terms.push({ type: 'instagram_handle', query: `@${instagram}`, value: target.instagram || null });
    }
    const childName = cleanText(target.canonical_child_name || target.canonicalChildName || target.child_name || target.childName);
    if (childName && childName.length >= 2) {
        terms.push({ type: 'child_name', query: childName, value: childName });
    }
    return terms;
}

function mapSearchabilityTarget(row = {}) {
    return {
        businessContext: row.business_context || row.businessContext || DEFAULT_BUSINESS_CONTEXT,
        leadId: row.lead_id ?? row.leadId ?? null,
        customerId: row.customer_id ?? row.customerId ?? row.id ?? null,
        name: row.name || null,
        phone: row.phone || null,
        instagram: row.instagram || null,
        childName: row.child_name || row.childName || null,
        childBirthday: row.child_birthday || row.childBirthday || null,
        canonicalChildName: row.canonical_child_name || row.canonicalChildName || null,
        sourceKinds: Array.isArray(row.source_kinds)
            ? row.source_kinds
            : parseJsonArray(row.source_kinds || row.sourceKinds)
    };
}

async function auditCustomerSearchability(queryable, options = {}) {
    if (!queryable || typeof queryable.query !== 'function') {
        throw new Error('A queryable client or pool is required');
    }
    const targetQuery = buildCustomerSearchabilityTargetQuery(options);
    const targetResult = await queryable.query(targetQuery.sql, targetQuery.params);
    const targets = (targetResult.rows || []).map(mapSearchabilityTarget);
    const user = options.user || { role: 'reception' };
    const includeSocialIdentities = options.includeSocialIdentities !== false;
    const results = [];

    for (const target of targets) {
        const checks = [];
        const terms = buildSearchabilityTerms(target, options);
        for (const term of terms) {
            const searchQuery = buildCustomerSearchQuery({
                query: term.query,
                businessContext: target.businessContext,
                user,
                includeSocialIdentities
            });
            if (!searchQuery) {
                checks.push({ ...term, searchable: false, skipped: true, resultIds: [] });
                continue;
            }
            const searchResult = await queryable.query(searchQuery.sql, searchQuery.params);
            const resultIds = (searchResult.rows || []).map(row => Number(row.id)).filter(Number.isInteger);
            checks.push({
                ...term,
                searchable: resultIds.includes(Number(target.customerId)),
                skipped: false,
                resultIds: resultIds.slice(0, 20)
            });
        }
        const failedChecks = checks.filter(check => !check.skipped && !check.searchable);
        results.push({
            ...target,
            classification: failedChecks.length ? 'not_searchable' : 'ok',
            checks,
            failedChecks
        });
    }

    return {
        scanned: results.length,
        ok: results.filter(item => item.classification === 'ok').length,
        notSearchable: results.filter(item => item.classification === 'not_searchable').length,
        options: {
            businessContext: options.businessContext ? normalizeBusinessContext(options.businessContext) : null,
            leadId: toPositiveInteger(options.leadId),
            includeCandidates: options.includeCandidates === true
        },
        results
    };
}

function buildCustomerDuplicateRiskQuery(options = {}) {
    const params = [];
    const customerContext = normalizedBusinessContextSql('c.business_context');
    const linkedCustomerContext = normalizedBusinessContextSql('c.business_context');
    const leadContext = normalizedBusinessContextSql('l.business_context');
    const linkContext = normalizedBusinessContextSql('lcl.business_context');
    const filters = [];
    const leadFilters = [`${effectiveLeadStageSql('l')} = ANY($1::text[])`];
    const stages = Array.isArray(options.stages) && options.stages.length
        ? options.stages.map(stage => String(stage || '').trim()).filter(Boolean)
        : [...CUSTOMER_CARD_PIPELINE_STAGES];
    params.push(stages);

    if (options.businessContext) {
        params.push(normalizeBusinessContext(options.businessContext));
        filters.push(`${customerContext} = $${params.length}`);
        leadFilters.push(`${leadContext} = $${params.length}`);
    }

    const customerWhere = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const leadWhere = leadFilters.join('\n      AND ');

    const sql = `
WITH customers_norm AS (
    SELECT
        c.id,
        ${customerContext} AS business_context,
        c.name,
        LOWER(NULLIF(BTRIM(c.name), '')) AS name_key,
        c.phone,
        REGEXP_REPLACE(COALESCE(c.phone, ''), '\\D', '', 'g') AS phone_digits,
        c.instagram,
        ${normalizedInstagramSql('c.instagram')} AS instagram_key,
        c.lead_id,
        c.updated_at
    FROM customers c
    ${customerWhere}
),
phone_groups AS (
    SELECT
        business_context,
        phone_digits,
        COUNT(*) AS risk_count,
        JSONB_AGG(JSONB_BUILD_OBJECT('id', id, 'name', name, 'phone', phone, 'instagram', instagram, 'leadId', lead_id) ORDER BY updated_at DESC NULLS LAST, id DESC) AS customers
    FROM customers_norm
    WHERE phone_digits <> ''
    GROUP BY business_context, phone_digits
    HAVING COUNT(*) > 1
),
instagram_groups AS (
    SELECT
        business_context,
        instagram_key,
        COUNT(*) AS risk_count,
        JSONB_AGG(JSONB_BUILD_OBJECT('id', id, 'name', name, 'phone', phone, 'instagram', instagram, 'leadId', lead_id) ORDER BY updated_at DESC NULLS LAST, id DESC) AS customers
    FROM customers_norm
    WHERE instagram_key <> ''
    GROUP BY business_context, instagram_key
    HAVING COUNT(*) > 1
),
same_name_close_phone AS (
    SELECT
        c.business_context,
        c.name_key,
        RIGHT(c.phone_digits, 7) AS phone_suffix,
        COUNT(DISTINCT c.id) AS risk_count,
        JSONB_AGG(DISTINCT JSONB_BUILD_OBJECT('id', c.id, 'name', c.name, 'phone', c.phone, 'instagram', c.instagram, 'leadId', c.lead_id)) AS customers
    FROM customers_norm c
    JOIN customers_norm c2
      ON c2.business_context = c.business_context
     AND c2.name_key = c.name_key
     AND c2.id <> c.id
     AND c.phone_digits <> ''
     AND c2.phone_digits <> ''
     AND c.phone_digits <> c2.phone_digits
     AND RIGHT(c.phone_digits, 7) = RIGHT(c2.phone_digits, 7)
    WHERE c.name_key IS NOT NULL
      AND LENGTH(c.phone_digits) >= 7
      AND LENGTH(c2.phone_digits) >= 7
    GROUP BY c.business_context, c.name_key, RIGHT(c.phone_digits, 7)
),
target_leads AS (
    SELECT
        l.id AS lead_id,
        ${leadContext} AS business_context,
        l.client_name,
        l.phone,
        REGEXP_REPLACE(COALESCE(l.phone, ''), '\\D', '', 'g') AS phone_digits,
        ${effectiveLeadStageSql('l')} AS pipeline_stage
    FROM leads l
    WHERE ${leadWhere}
),
linked_customers AS (
    SELECT
        tl.lead_id,
        tl.business_context,
        lcl.customer_id AS linked_customer_id,
        c.name AS linked_customer_name,
        c.phone AS linked_customer_phone,
        lcl.id AS link_id
    FROM target_leads tl
    JOIN lead_customer_links lcl
      ON lcl.lead_id = tl.lead_id
     AND ${linkContext} = tl.business_context
    JOIN customers c
      ON c.id = lcl.customer_id
     AND ${linkedCustomerContext} = tl.business_context
),
phone_candidate_mismatches AS (
    SELECT
        tl.business_context,
        tl.lead_id,
        tl.client_name,
        tl.phone AS lead_phone,
        tl.phone_digits,
        JSONB_AGG(DISTINCT JSONB_BUILD_OBJECT(
            'linkId', lc.link_id,
            'linkedCustomerId', lc.linked_customer_id,
            'linkedCustomerName', lc.linked_customer_name,
            'linkedCustomerPhone', lc.linked_customer_phone
        )) AS linked_customers,
        JSONB_AGG(DISTINCT JSONB_BUILD_OBJECT(
            'id', cand.id,
            'name', cand.name,
            'phone', cand.phone,
            'instagram', cand.instagram,
            'leadId', cand.lead_id
        )) AS candidates,
        COUNT(DISTINCT cand.id) AS risk_count
    FROM target_leads tl
    JOIN linked_customers lc
      ON lc.lead_id = tl.lead_id
     AND lc.business_context = tl.business_context
    JOIN customers_norm cand
      ON cand.business_context = tl.business_context
     AND cand.phone_digits = tl.phone_digits
     AND cand.id <> lc.linked_customer_id
    WHERE tl.phone_digits <> ''
    GROUP BY tl.business_context, tl.lead_id, tl.client_name, tl.phone, tl.phone_digits
)
SELECT 'duplicate_phone' AS risk_type,
       'manual_review' AS action,
       business_context,
       NULL::integer AS lead_id,
       phone_digits AS match_key,
       risk_count,
       customers AS details
FROM phone_groups
UNION ALL
SELECT 'duplicate_instagram' AS risk_type,
       'manual_review' AS action,
       business_context,
       NULL::integer AS lead_id,
       instagram_key AS match_key,
       risk_count,
       customers AS details
FROM instagram_groups
UNION ALL
SELECT 'same_name_close_phone' AS risk_type,
       'manual_review' AS action,
       business_context,
       NULL::integer AS lead_id,
       name_key || ':' || phone_suffix AS match_key,
       risk_count,
       customers AS details
FROM same_name_close_phone
UNION ALL
SELECT 'lead_link_phone_candidate_mismatch' AS risk_type,
       'manual_review' AS action,
       business_context,
       lead_id,
       phone_digits AS match_key,
       risk_count,
       JSONB_BUILD_OBJECT(
           'leadName', client_name,
           'leadPhone', lead_phone,
           'linkedCustomers', linked_customers,
           'phoneCandidates', candidates
       ) AS details
FROM phone_candidate_mismatches
ORDER BY business_context, risk_type, lead_id NULLS LAST, match_key`;

    return { sql, params };
}

async function auditCustomerDuplicateRisks(queryable, options = {}) {
    if (!queryable || typeof queryable.query !== 'function') {
        throw new Error('A queryable client or pool is required');
    }
    const query = buildCustomerDuplicateRiskQuery(options);
    const result = await queryable.query(query.sql, query.params);
    const risks = (result.rows || []).map(row => ({
        riskType: row.risk_type || row.riskType,
        action: row.action || 'manual_review',
        businessContext: row.business_context || row.businessContext || DEFAULT_BUSINESS_CONTEXT,
        leadId: row.lead_id ?? row.leadId ?? null,
        matchKey: row.match_key || row.matchKey || null,
        riskCount: parseInt(row.risk_count, 10) || 0,
        details: row.details || {}
    }));
    const byType = risks.reduce((acc, item) => {
        acc[item.riskType] = (acc[item.riskType] || 0) + 1;
        return acc;
    }, {});
    return {
        scanned: risks.length,
        byType,
        manualReviewCount: risks.length,
        options: {
            businessContext: options.businessContext ? normalizeBusinessContext(options.businessContext) : null
        },
        risks
    };
}

function buildBusinessContextIsolationAuditQuery(options = {}) {
    const stages = Array.isArray(options.stages) && options.stages.length
        ? options.stages.map(stage => String(stage || '').trim()).filter(Boolean)
        : [...CUSTOMER_CARD_PIPELINE_STAGES];
    const params = [stages];
    const leadContext = normalizedBusinessContextSql('l.business_context');
    const customerContext = normalizedBusinessContextSql('c.business_context');
    const filters = [`${effectiveLeadStageSql('l')} = ANY($1::text[])`];

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
        ${leadContext} AS lead_context,
        REGEXP_REPLACE(COALESCE(l.phone, ''), '\\D', '', 'g') AS phone_digits,
        ${normalizedInstagramSql('l.instagram')} AS instagram_key,
        ${effectiveLeadStageSql('l')} AS pipeline_stage,
        l.updated_at,
        l.created_at
    FROM leads l
    WHERE ${filters.join('\n      AND ')}
    ORDER BY l.updated_at DESC NULLS LAST, l.created_at DESC NULLS LAST, l.id DESC
    ${limitSql}
),
context_mismatches AS (
    SELECT
        tl.lead_id,
        tl.lead_context,
        c.id AS customer_id,
        ${customerContext} AS customer_context,
        ARRAY_AGG(DISTINCT match_source ORDER BY match_source) AS match_sources
    FROM target_leads tl
    JOIN customers c
      ON (
         (
            tl.phone_digits <> ''
        AND REGEXP_REPLACE(COALESCE(c.phone, ''), '\\D', '', 'g') = tl.phone_digits
         )
      OR (
            tl.instagram_key <> ''
        AND ${normalizedInstagramSql('c.instagram')} = tl.instagram_key
         )
      )
    CROSS JOIN LATERAL (
        SELECT 'phone' AS match_source
        WHERE tl.phone_digits <> ''
          AND REGEXP_REPLACE(COALESCE(c.phone, ''), '\\D', '', 'g') = tl.phone_digits
        UNION ALL
        SELECT 'instagram' AS match_source
        WHERE tl.instagram_key <> ''
          AND ${normalizedInstagramSql('c.instagram')} = tl.instagram_key
    ) matches
    WHERE ${customerContext} <> tl.lead_context
    GROUP BY tl.lead_id, tl.lead_context, c.id, ${customerContext}
)
SELECT
    lead_id,
    lead_context,
    customer_id,
    customer_context,
    'context_mismatch' AS reason,
    match_sources
FROM context_mismatches
ORDER BY lead_context, lead_id, customer_id`;

    return { sql, params };
}

async function auditBusinessContextIsolation(queryable, options = {}) {
    if (!queryable || typeof queryable.query !== 'function') {
        throw new Error('A queryable client or pool is required');
    }
    const query = buildBusinessContextIsolationAuditQuery(options);
    const result = await queryable.query(query.sql, query.params);
    const results = (result.rows || []).map(row => ({
        leadId: row.lead_id ?? row.leadId ?? null,
        leadContext: row.lead_context || row.leadContext || DEFAULT_BUSINESS_CONTEXT,
        customerId: row.customer_id ?? row.customerId ?? null,
        customerContext: row.customer_context || row.customerContext || DEFAULT_BUSINESS_CONTEXT,
        reason: row.reason || 'context_mismatch',
        matchSources: Array.isArray(row.match_sources)
            ? row.match_sources
            : parseJsonArray(row.match_sources || row.matchSources)
    }));
    return {
        scanned: results.length,
        contextMismatchCount: results.length,
        options: {
            businessContext: options.businessContext ? normalizeBusinessContext(options.businessContext) : null,
            leadId: toPositiveInteger(options.leadId),
            limit: toPositiveInteger(options.limit)
        },
        results
    };
}

function validBirthdaySql(expression) {
    const value = `NULLIF(BTRIM(${expression}), '')`;
    const month = `SUBSTRING(${value} FROM 6 FOR 2)`;
    const day = `SUBSTRING(${value} FROM 9 FOR 2)`;
    return `(CASE
        WHEN ${value} ~ '^\\d{4}-\\d{2}-\\d{2}$'
         AND ${month} BETWEEN '01' AND '12'
         AND ${day} BETWEEN '01' AND CASE ${month}
             WHEN '02' THEN '29'
             WHEN '04' THEN '30'
             WHEN '06' THEN '30'
             WHEN '09' THEN '30'
             WHEN '11' THEN '30'
             ELSE '31'
         END
        THEN ${value}
        ELSE NULL
    END)`;
}

function buildLeadCustomerChildrenSyncAuditQuery(options = {}) {
    const stages = Array.isArray(options.stages) && options.stages.length
        ? options.stages.map(stage => String(stage || '').trim()).filter(Boolean)
        : [...CUSTOMER_CARD_PIPELINE_STAGES];
    const params = [stages];
    const leadContext = normalizedBusinessContextSql('l.business_context');
    const customerContext = normalizedBusinessContextSql('c.business_context');
    const linkContext = normalizedBusinessContextSql('lcl.business_context');
    const filters = [`${effectiveLeadStageSql('l')} = ANY($1::text[])`];

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
    const birthdayValue = "COALESCE(celebrant.item->>'birthday', celebrant.item->>'birthDate', celebrant.item->>'birth_date')";

    const sql = `
WITH target_leads AS (
    SELECT
        l.id AS lead_id,
        ${leadContext} AS business_context,
        l.client_name,
        COALESCE(l.celebrants, '[]'::jsonb) AS celebrants,
        ${effectiveLeadStageSql('l')} AS pipeline_stage,
        l.updated_at,
        l.created_at
    FROM leads l
    WHERE ${filters.join('\n      AND ')}
      AND jsonb_typeof(COALESCE(l.celebrants, '[]'::jsonb)) = 'array'
      AND jsonb_array_length(COALESCE(l.celebrants, '[]'::jsonb)) > 0
    ORDER BY l.updated_at DESC NULLS LAST, l.created_at DESC NULLS LAST, l.id DESC
    ${limitSql}
),
linked_customers AS (
    SELECT DISTINCT tl.lead_id, tl.business_context, c.id AS customer_id
    FROM target_leads tl
    JOIN customers c
      ON c.lead_id = tl.lead_id
     AND ${customerContext} = tl.business_context
    UNION
    SELECT DISTINCT tl.lead_id, tl.business_context, c.id AS customer_id
    FROM target_leads tl
    JOIN lead_customer_links lcl
      ON lcl.lead_id = tl.lead_id
     AND ${linkContext} = tl.business_context
    JOIN customers c
      ON c.id = lcl.customer_id
     AND ${customerContext} = tl.business_context
),
lead_celebrants AS (
    SELECT
        tl.lead_id,
        tl.business_context,
        tl.client_name,
        (celebrant.ordinality - 1)::integer AS celebrant_index,
        NULLIF(BTRIM(COALESCE(celebrant.item->>'name', celebrant.item->>'childName', celebrant.item->>'child_name')), '') AS child_name,
        ${validBirthdaySql(birthdayValue)} AS child_birthday,
        NULLIF(BTRIM(COALESCE(celebrant.item->>'notes', celebrant.item->>'note')), '') AS child_note,
        CASE
            WHEN COALESCE(celebrant.item->>'age', celebrant.item->>'childAge', celebrant.item->>'child_age') ~ '^\\d{1,3}$'
             AND LPAD(COALESCE(celebrant.item->>'age', celebrant.item->>'childAge', celebrant.item->>'child_age'), 3, '0') BETWEEN '000' AND '120'
            THEN (COALESCE(celebrant.item->>'age', celebrant.item->>'childAge', celebrant.item->>'child_age'))::integer
            ELSE NULL
        END AS age_snapshot
    FROM target_leads tl
    CROSS JOIN LATERAL jsonb_array_elements(tl.celebrants) WITH ORDINALITY AS celebrant(item, ordinality)
    WHERE celebrant.ordinality <= 20
),
normalized_celebrants AS (
    SELECT *
    FROM lead_celebrants
    WHERE child_name IS NOT NULL
       OR child_birthday IS NOT NULL
       OR child_note IS NOT NULL
       OR age_snapshot IS NOT NULL
),
celebrant_checks AS (
    SELECT
        nc.lead_id,
        nc.business_context,
        nc.client_name,
        lc.customer_id,
        nc.celebrant_index,
        nc.child_name,
        nc.child_birthday,
        nc.age_snapshot,
        child.id AS child_id
    FROM normalized_celebrants nc
    LEFT JOIN linked_customers lc
      ON lc.lead_id = nc.lead_id
     AND lc.business_context = nc.business_context
    LEFT JOIN LATERAL (
        SELECT cc.id
        FROM customer_children cc
        WHERE lc.customer_id IS NOT NULL
          AND cc.business_context = nc.business_context
          AND cc.customer_id = lc.customer_id
          AND cc.lead_id = nc.lead_id
          AND cc.source_kind = 'lead_celebrant'
          AND (
                CASE WHEN cc.source_payload->>'input_index' ~ '^\\d+$' THEN (cc.source_payload->>'input_index')::integer ELSE NULL END = nc.celebrant_index
             OR CASE WHEN cc.source_payload->>'celebrant_index' ~ '^\\d+$' THEN (cc.source_payload->>'celebrant_index')::integer ELSE NULL END = nc.celebrant_index
             OR (
                    (nc.child_name IS NULL OR LOWER(NULLIF(BTRIM(cc.name), '')) = LOWER(nc.child_name))
                AND (nc.child_birthday IS NULL OR cc.birthday::text = nc.child_birthday)
                )
          )
        ORDER BY cc.sort_order ASC NULLS LAST, cc.id ASC
        LIMIT 1
    ) child ON true
)
SELECT
    lead_id,
    business_context,
    client_name,
    customer_id,
    COUNT(*) AS celebrant_count,
    COUNT(child_id) AS synced_child_count,
    COUNT(*) FILTER (WHERE child_id IS NULL) AS missing_child_count,
    JSONB_AGG(JSONB_BUILD_OBJECT(
        'index', celebrant_index,
        'name', child_name,
        'birthday', child_birthday,
        'ageSnapshot', age_snapshot
    ) ORDER BY celebrant_index) FILTER (WHERE child_id IS NULL) AS missing_celebrants,
    CASE
        WHEN customer_id IS NULL THEN 'missing_customer_link'
        WHEN COUNT(*) FILTER (WHERE child_id IS NULL) > 0 THEN 'missing_customer_child'
        ELSE 'ok'
    END AS classification
FROM celebrant_checks
GROUP BY lead_id, business_context, client_name, customer_id
ORDER BY business_context, lead_id, customer_id NULLS FIRST`;

    return { sql, params };
}

async function auditLeadCustomerChildrenSync(queryable, options = {}) {
    if (!queryable || typeof queryable.query !== 'function') {
        throw new Error('A queryable client or pool is required');
    }
    const query = buildLeadCustomerChildrenSyncAuditQuery(options);
    const result = await queryable.query(query.sql, query.params);
    const results = (result.rows || []).map(row => ({
        leadId: row.lead_id ?? row.leadId ?? null,
        businessContext: row.business_context || row.businessContext || DEFAULT_BUSINESS_CONTEXT,
        clientName: row.client_name || row.clientName || null,
        customerId: row.customer_id ?? row.customerId ?? null,
        celebrantCount: parseInt(row.celebrant_count, 10) || 0,
        syncedChildCount: parseInt(row.synced_child_count, 10) || 0,
        missingChildCount: parseInt(row.missing_child_count, 10) || 0,
        missingCelebrants: parseJsonArray(row.missing_celebrants || row.missingCelebrants),
        classification: row.classification || 'ok'
    }));
    const byClassification = results.reduce((acc, item) => {
        acc[item.classification] = (acc[item.classification] || 0) + 1;
        return acc;
    }, {});
    return {
        scanned: results.length,
        issueCount: results.filter(item => item.classification !== 'ok').length,
        byClassification,
        options: {
            businessContext: options.businessContext ? normalizeBusinessContext(options.businessContext) : null,
            leadId: toPositiveInteger(options.leadId),
            limit: toPositiveInteger(options.limit)
        },
        results
    };
}

module.exports = {
    auditBusinessContextIsolation,
    auditCustomerDuplicateRisks,
    auditCustomerSearchability,
    auditLeadCustomerChildrenSync,
    buildBusinessContextIsolationAuditQuery,
    buildCustomerDuplicateRiskQuery,
    buildLeadCustomerChildrenSyncAuditQuery,
    buildCustomerSearchabilityTargetQuery,
    buildSearchabilityTerms,
    customerNamePrefix
};

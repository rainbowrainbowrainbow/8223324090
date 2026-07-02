const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    AUDIT_CLASSIFICATIONS,
    auditLeadCustomerCards,
    buildLeadCustomerAuditQuery,
    buildLeadCustomerAuditResult,
    classifyLeadCustomerAuditRow,
    normalizeDigits,
    normalizeInstagram
} = require('../services/leadCustomerAudit');

function baseRow(overrides = {}) {
    return {
        lead_id: 501,
        business_context: 'event_genix',
        raw_business_context: 'event_genix',
        client_name: 'Test Lead',
        phone: '+38 (097) 111-22-33',
        instagram: '@test_lead',
        phone_digits: '380971112233',
        instagram_key: 'test_lead',
        pipeline_stage: 'deposit_received',
        status: 'booked',
        direct_customer_count: 0,
        direct_wrong_context_count: 0,
        customers_by_lead_id: [],
        direct_wrong_context_customers: [],
        linked_customer_count: 0,
        broken_link_count: 0,
        linked_wrong_context_count: 0,
        linked_customers: [],
        broken_links: [],
        linked_wrong_context_customers: [],
        phone_candidate_count: 0,
        phone_wrong_context_count: 0,
        phone_candidates: [],
        phone_wrong_context_candidates: [],
        instagram_candidate_count: 0,
        instagram_wrong_context_count: 0,
        instagram_candidates: [],
        instagram_wrong_context_candidates: [],
        ...overrides
    };
}

describe('lead customer card audit classification', () => {
    it('normalizes phone digits and Instagram handles like lead linking', () => {
        assert.equal(normalizeDigits('+38 (097) 426-97-9'), '38097426979');
        assert.equal(normalizeInstagram('@@BeliChenko'), 'belichenko');
    });

    it('classifies an existing same-context customer link as ok', () => {
        const row = baseRow({
            direct_customer_count: 1,
            linked_customer_count: 1,
            customers_by_lead_id: [{ id: 701, businessContext: 'event_genix', match: 'customers.lead_id' }],
            linked_customers: [{ id: 701, businessContext: 'event_genix', match: 'lead_customer_links' }]
        });

        const result = buildLeadCustomerAuditResult(row);

        assert.equal(result.classification, 'ok');
        assert.equal(result.checks.hasCustomerLeadId, true);
        assert.equal(result.checks.hasLeadCustomerLink, true);
    });

    it('classifies a lead with no customer and no candidates', () => {
        assert.equal(classifyLeadCustomerAuditRow(baseRow()), 'missing_customer_no_candidate');
    });

    it('classifies a lead with one same-context candidate', () => {
        const row = baseRow({
            phone_candidate_count: 1,
            phone_candidates: [{ id: 702, name: 'Candidate', businessContext: 'event_genix', match: 'phone' }]
        });

        const result = buildLeadCustomerAuditResult(row);

        assert.equal(result.classification, 'missing_customer_single_candidate');
        assert.equal(result.candidateCustomers.length, 1);
        assert.deepEqual(result.candidateCustomers[0].matches, ['phone']);
    });

    it('deduplicates phone and Instagram matches before classifying one candidate', () => {
        const row = baseRow({
            phone_candidate_count: 1,
            instagram_candidate_count: 1,
            phone_candidates: [{ id: 703, name: 'Same Candidate', businessContext: 'event_genix', match: 'phone' }],
            instagram_candidates: [{ id: 703, name: 'Same Candidate', businessContext: 'event_genix', match: 'instagram' }]
        });

        const result = buildLeadCustomerAuditResult(row);

        assert.equal(result.classification, 'missing_customer_single_candidate');
        assert.equal(result.candidateCustomers.length, 1);
        assert.deepEqual(result.candidateCustomers[0].matches.sort(), ['instagram', 'phone']);
    });

    it('classifies multiple same-context candidates as ambiguous', () => {
        const row = baseRow({
            phone_candidate_count: 1,
            instagram_candidate_count: 1,
            phone_candidates: [{ id: 704, name: 'Candidate A', businessContext: 'event_genix', match: 'phone' }],
            instagram_candidates: [{ id: 705, name: 'Candidate B', businessContext: 'event_genix', match: 'instagram' }]
        });

        assert.equal(classifyLeadCustomerAuditRow(row), 'missing_customer_ambiguous_candidates');
    });

    it('classifies explicit foreign-context customer relations as wrong_business_context', () => {
        const row = baseRow({
            direct_wrong_context_count: 1,
            direct_wrong_context_customers: [{ id: 706, name: 'Wrong Tenant', businessContext: 'dar', match: 'customers.lead_id' }]
        });

        const result = buildLeadCustomerAuditResult(row);

        assert.equal(result.classification, 'wrong_business_context');
        assert.equal(result.checks.hasWrongBusinessContext, true);
        assert.equal(result.wrongContextCandidates.length, 1);
    });

    it('classifies only foreign-context phone or Instagram candidates as wrong_business_context', () => {
        const row = baseRow({
            phone_wrong_context_count: 1,
            phone_wrong_context_candidates: [{ id: 707, name: 'Other Business', businessContext: 'dar', match: 'phone' }]
        });

        assert.equal(classifyLeadCustomerAuditRow(row), 'wrong_business_context');
    });

    it('classifies stale lead_customer_links rows before other issues', () => {
        const row = baseRow({
            phone_candidate_count: 1,
            phone_candidates: [{ id: 708, name: 'Candidate', businessContext: 'event_genix', match: 'phone' }],
            broken_link_count: 1,
            broken_links: [{ linkId: 9001, leadId: 501, customerId: 9999 }]
        });

        const result = buildLeadCustomerAuditResult(row);

        assert.equal(result.classification, 'broken_link_customer_missing');
        assert.equal(result.checks.hasBrokenLeadCustomerLink, true);
    });
});

describe('lead customer card audit query', () => {
    it('builds a scoped read-only audit query', () => {
        const { sql, params } = buildLeadCustomerAuditQuery({
            businessContext: 'pzp',
            leadId: '501',
            limit: '10'
        });

        assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/i);
        assert.match(sql, /WITH target_leads AS/i);
        assert.match(sql, /FROM leads l/i);
        assert.match(sql, /LEFT JOIN customers c ON c\.lead_id = tl\.lead_id/i);
        assert.match(sql, /LEFT JOIN lead_customer_links lcl ON lcl\.lead_id = tl\.lead_id/i);
        assert.match(sql, /LIMIT 10/i);
        assert.deepEqual(params[0], ['deal', 'deposit_received', 'waiting', 'completed', 'closed']);
        assert.equal(params[1], 'event_genix');
        assert.equal(params[2], 501);
    });

    it('returns counts for every audit classification', async () => {
        const rows = AUDIT_CLASSIFICATIONS.map((classification, index) => {
            if (classification === 'ok') {
                return baseRow({
                    lead_id: 600 + index,
                    direct_customer_count: 1,
                    customers_by_lead_id: [{ id: 800 + index, businessContext: 'event_genix' }]
                });
            }
            if (classification === 'missing_customer_single_candidate') {
                return baseRow({
                    lead_id: 600 + index,
                    phone_candidate_count: 1,
                    phone_candidates: [{ id: 800 + index, businessContext: 'event_genix', match: 'phone' }]
                });
            }
            if (classification === 'missing_customer_ambiguous_candidates') {
                return baseRow({
                    lead_id: 600 + index,
                    phone_candidates: [{ id: 801, businessContext: 'event_genix', match: 'phone' }],
                    instagram_candidates: [{ id: 802, businessContext: 'event_genix', match: 'instagram' }]
                });
            }
            if (classification === 'wrong_business_context') {
                return baseRow({
                    lead_id: 600 + index,
                    direct_wrong_context_count: 1,
                    direct_wrong_context_customers: [{ id: 803, businessContext: 'dar', match: 'customers.lead_id' }]
                });
            }
            if (classification === 'broken_link_customer_missing') {
                return baseRow({
                    lead_id: 600 + index,
                    broken_link_count: 1,
                    broken_links: [{ linkId: 11, customerId: 900 }]
                });
            }
            return baseRow({ lead_id: 600 + index });
        });
        const queryable = {
            query: async (sql, params) => {
                assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/i);
                assert.equal(params[1], 'event_genix');
                return { rows };
            }
        };

        const report = await auditLeadCustomerCards(queryable, { businessContext: 'park', limit: 100 });

        assert.equal(report.scanned, AUDIT_CLASSIFICATIONS.length);
        for (const key of AUDIT_CLASSIFICATIONS) {
            assert.equal(report.classifications[key], 1);
        }
        assert.equal(report.issueCount, AUDIT_CLASSIFICATIONS.length - 1);
    });
});

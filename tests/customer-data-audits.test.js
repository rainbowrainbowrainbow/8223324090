const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    auditBusinessContextIsolation,
    auditCustomerDuplicateRisks,
    auditCustomerSearchability,
    auditLeadCustomerChildrenSync,
    buildBusinessContextIsolationAuditQuery,
    buildCustomerDuplicateRiskQuery,
    buildLeadCustomerChildrenSyncAuditQuery,
    buildSearchabilityTerms,
    customerNamePrefix
} = require('../services/customerDataAudits');

describe('customer searchability audit', () => {
    it('builds the requested booking search terms from a customer', () => {
        const terms = buildSearchabilityTerms({
            name: 'Беліченко Альона',
            phone: '+38 (097) 426-97-9',
            instagram: '@beli_event',
            canonical_child_name: 'Софія'
        });

        assert.equal(customerNamePrefix('Беліченко Альона'), 'Белі');
        assert.deepEqual(terms.map(term => [term.type, term.query]), [
            ['name_prefix', 'Белі'],
            ['phone_digits', '38097426979'],
            ['instagram_handle', '@beli_event'],
            ['child_name', 'Софія']
        ]);
    });

    it('marks a customer not searchable when /api/customers/search-equivalent results omit it', async () => {
        const queries = [];
        const queryable = {
            query: async (sql, params = []) => {
                queries.push({ sql, params });
                if (/WITH target_leads AS/i.test(sql) && /raw_targets AS/i.test(sql)) {
                    return {
                        rows: [{
                            business_context: 'event_genix',
                            lead_id: 501,
                            customer_id: 701,
                            name: 'Беліченко Альона',
                            phone: '+38097426979',
                            instagram: 'beli_event',
                            canonical_child_name: 'Софія',
                            source_kinds: ['lead_customer_links']
                        }]
                    };
                }
                const pattern = params[0];
                if (pattern === '%38097426979%') return { rows: [{ id: 999 }] };
                return { rows: [{ id: 701 }] };
            }
        };

        const report = await auditCustomerSearchability(queryable, { businessContext: 'event_genix' });

        assert.equal(report.scanned, 1);
        assert.equal(report.notSearchable, 1);
        assert.equal(report.results[0].classification, 'not_searchable');
        assert.deepEqual(report.results[0].failedChecks.map(check => check.type), ['phone_digits']);
        assert.ok(queries.slice(1).every(query => /FROM customers c/i.test(query.sql)));
    });
});

describe('customer duplicate risk audit', () => {
    it('builds a read-only duplicate risk query for all manual-review categories', () => {
        const { sql, params } = buildCustomerDuplicateRiskQuery({ businessContext: 'park' });

        assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/i);
        assert.match(sql, /duplicate_phone/);
        assert.match(sql, /duplicate_instagram/);
        assert.match(sql, /same_name_close_phone/);
        assert.match(sql, /lead_link_phone_candidate_mismatch/);
        assert.deepEqual(params[0], ['deal', 'deposit_received', 'waiting', 'completed', 'closed']);
        assert.equal(params[1], 'event_genix');
    });

    it('returns duplicate risks as manual-review only', async () => {
        const queryable = {
            query: async (sql, params = []) => {
                assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/i);
                assert.equal(params[1], 'event_genix');
                return {
                    rows: [
                        {
                            risk_type: 'duplicate_phone',
                            action: 'manual_review',
                            business_context: 'event_genix',
                            match_key: '380971111111',
                            risk_count: 2,
                            details: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }]
                        },
                        {
                            risk_type: 'lead_link_phone_candidate_mismatch',
                            action: 'manual_review',
                            business_context: 'event_genix',
                            lead_id: 501,
                            match_key: '380972222222',
                            risk_count: 1,
                            details: { leadName: 'Lead', linkedCustomers: [], phoneCandidates: [] }
                        }
                    ]
                };
            }
        };

        const report = await auditCustomerDuplicateRisks(queryable, { businessContext: 'pzp' });

        assert.equal(report.manualReviewCount, 2);
        assert.deepEqual(report.byType, {
            duplicate_phone: 1,
            lead_link_phone_candidate_mismatch: 1
        });
        assert.ok(report.risks.every(risk => risk.action === 'manual_review'));
    });
});

describe('business context isolation audit', () => {
    it('builds a read-only context mismatch report for cross-business candidates', () => {
        const { sql, params } = buildBusinessContextIsolationAuditQuery({
            businessContext: 'park',
            leadId: '501',
            limit: '25'
        });

        assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/i);
        assert.match(sql, /context_mismatch/);
        assert.match(sql, /lead_context/);
        assert.match(sql, /customer_context/);
        assert.match(sql, /REGEXP_REPLACE\(COALESCE\(c\.phone/);
        assert.match(sql, /REGEXP_REPLACE\(BTRIM\(COALESCE\(c\.instagram/);
        assert.deepEqual(params[0], ['deal', 'deposit_received', 'waiting', 'completed', 'closed']);
        assert.equal(params[1], 'event_genix');
        assert.equal(params[2], 501);
    });

    it('returns only report rows with context_mismatch reason', async () => {
        const queryable = {
            query: async (sql, params = []) => {
                assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/i);
                assert.equal(params[1], 'dar');
                return {
                    rows: [{
                        lead_id: 501,
                        lead_context: 'dar',
                        customer_id: 701,
                        customer_context: 'event_genix',
                        reason: 'context_mismatch',
                        match_sources: ['phone', 'instagram']
                    }]
                };
            }
        };

        const report = await auditBusinessContextIsolation(queryable, { businessContext: 'dar' });

        assert.equal(report.contextMismatchCount, 1);
        assert.deepEqual(report.results[0], {
            leadId: 501,
            leadContext: 'dar',
            customerId: 701,
            customerContext: 'event_genix',
            reason: 'context_mismatch',
            matchSources: ['phone', 'instagram']
        });
    });
});

describe('lead customer children sync audit', () => {
    it('builds a read-only audit query scoped to lead-owned customer children', () => {
        const { sql, params } = buildLeadCustomerChildrenSyncAuditQuery({
            businessContext: 'pzp',
            leadId: '501',
            limit: '10'
        });

        assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/i);
        assert.match(sql, /jsonb_array_elements\(tl\.celebrants\)/);
        assert.match(sql, /FROM customer_children cc/);
        assert.match(sql, /cc\.source_kind = 'lead_celebrant'/);
        assert.match(sql, /cc\.lead_id = nc\.lead_id/);
        assert.match(sql, /source_payload->>'input_index'/);
        assert.match(sql, /source_payload->>'celebrant_index'/);
        assert.deepEqual(params[0], ['deal', 'deposit_received', 'waiting', 'completed', 'closed']);
        assert.equal(params[1], 'event_genix');
        assert.equal(params[2], 501);
    });

    it('reports missing celebrant rows without fixing them', async () => {
        const queryable = {
            query: async (sql, params = []) => {
                assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/i);
                assert.equal(params[1], 'event_genix');
                return {
                    rows: [
                        {
                            lead_id: 501,
                            business_context: 'event_genix',
                            client_name: 'Lead With Child',
                            customer_id: 701,
                            celebrant_count: '2',
                            synced_child_count: '1',
                            missing_child_count: '1',
                            missing_celebrants: [{ index: 1, name: 'Second Child', birthday: null }],
                            classification: 'missing_customer_child'
                        },
                        {
                            lead_id: 502,
                            business_context: 'event_genix',
                            client_name: 'Synced Lead',
                            customer_id: 702,
                            celebrant_count: '1',
                            synced_child_count: '1',
                            missing_child_count: '0',
                            missing_celebrants: [],
                            classification: 'ok'
                        }
                    ]
                };
            }
        };

        const report = await auditLeadCustomerChildrenSync(queryable, { businessContext: 'park' });

        assert.equal(report.scanned, 2);
        assert.equal(report.issueCount, 1);
        assert.deepEqual(report.byClassification, {
            missing_customer_child: 1,
            ok: 1
        });
        assert.equal(report.results[0].missingCelebrants[0].name, 'Second Child');
    });
});

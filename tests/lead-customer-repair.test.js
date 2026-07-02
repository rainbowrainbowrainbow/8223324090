const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    planLeadCustomerCardRepairs,
    repairLeadCustomerCards,
    repairLeadCustomerChildren
} = require('../services/leadCustomerRepair');

function cardAuditResult(overrides = {}) {
    return {
        leadId: 501,
        businessContext: 'event_genix',
        classification: 'missing_customer_no_candidate',
        candidateCustomers: [],
        wrongContextCandidates: [],
        checks: {
            hasWrongBusinessContext: false,
            hasBrokenLeadCustomerLink: false,
            sameContextCandidateCount: 0
        },
        ...overrides
    };
}

function cardAuditReport(results) {
    return {
        scanned: results.length,
        issueCount: results.filter(item => item.classification !== 'ok').length,
        classifications: results.reduce((acc, item) => {
            acc[item.classification] = (acc[item.classification] || 0) + 1;
            return acc;
        }, {}),
        results
    };
}

function childrenAuditReport(results) {
    return {
        scanned: results.length,
        issueCount: results.filter(item => item.classification !== 'ok').length,
        byClassification: results.reduce((acc, item) => {
            acc[item.classification] = (acc[item.classification] || 0) + 1;
            return acc;
        }, {}),
        results
    };
}

function createFakeRepairDb({ leads = [], customers = [], children = [] } = {}) {
    const state = {
        leads: leads.map(row => ({ ...row })),
        customers: customers.map(row => ({ ...row })),
        children: children.map(row => ({ ...row })),
        links: []
    };
    const queries = [];
    const db = {
        state,
        queries,
        async query(sql, params = []) {
            queries.push({ sql, params });
            if (/^\s*SELECT \*/i.test(sql) && /FROM leads/i.test(sql)) {
                return {
                    rows: state.leads.filter(row =>
                        Number(row.id) === Number(params[0])
                        && (row.business_context || 'event_genix') === params[1]
                    ).slice(0, 1)
                };
            }
            if (/^\s*SELECT \*/i.test(sql) && /FROM customers/i.test(sql)) {
                return {
                    rows: state.customers.filter(row =>
                        Number(row.id) === Number(params[0])
                        && (row.business_context || 'event_genix') === params[1]
                    ).slice(0, 1)
                };
            }
            if (/INSERT INTO customers \(business_context, name, phone, instagram, child_name, source, notes, lead_id, social_identities\)/i.test(sql)) {
                const row = {
                    id: 9000 + state.customers.length,
                    business_context: params[0],
                    name: params[1],
                    phone: params[2],
                    instagram: params[3],
                    child_name: params[4],
                    source: params[5],
                    notes: params[6],
                    lead_id: params[7],
                    social_identities: JSON.parse(params[8] || '[]')
                };
                state.customers.push(row);
                return { rows: [row], rowCount: 1 };
            }
            if (/UPDATE customers\s+SET name = COALESCE/i.test(sql)) {
                const customer = state.customers.find(row =>
                    Number(row.id) === Number(params[8])
                    && (row.business_context || 'event_genix') === params[9]
                );
                if (!customer) return { rows: [], rowCount: 0 };
                customer.name = customer.name || params[0];
                customer.phone = customer.phone || params[1];
                customer.instagram = customer.instagram || params[2];
                customer.child_name = customer.child_name || params[3];
                customer.source = customer.source || params[4];
                customer.notes = params[5];
                if (!customer.lead_id || Number(customer.lead_id) === Number(params[6])) {
                    customer.lead_id = params[6];
                }
                return { rows: [customer], rowCount: 1 };
            }
            if (/INSERT INTO lead_customer_links/i.test(sql)) {
                const row = {
                    id: 10000 + state.links.length,
                    business_context: params[0],
                    lead_id: params[1],
                    customer_id: params[2],
                    link_type: params[3],
                    source: params[4],
                    metadata: JSON.parse(params[5] || '{}'),
                    created_by: params[6]
                };
                state.links.push(row);
                return { rows: [row], rowCount: 1 };
            }
            if (/DELETE FROM customer_children/i.test(sql)) {
                state.children = state.children.filter(row =>
                    !(Number(row.customer_id) === Number(params[0])
                        && row.business_context === params[1]
                        && row.source_kind === params[2]
                        && Number(row.lead_id) === Number(params[3]))
                );
                return { rows: [], rowCount: 1 };
            }
            if (/INSERT INTO customer_children/i.test(sql)) {
                const row = {
                    id: 20000 + state.children.length,
                    business_context: params[0],
                    customer_id: params[1],
                    lead_id: params[2],
                    booking_id: params[3],
                    name: params[4],
                    birthday: params[5],
                    age_snapshot: params[6],
                    note: params[7],
                    source_kind: params[8],
                    source_payload: JSON.parse(params[9] || '{}'),
                    sort_order: params[10]
                };
                state.children.push(row);
                return { rows: [row], rowCount: 1 };
            }
            if (/FROM customer_children/i.test(sql)) {
                return {
                    rows: state.children.filter(row =>
                        Number(row.customer_id) === Number(params[0])
                        && row.business_context === params[1]
                    )
                };
            }
            if (/UPDATE customers\s+SET child_name = CASE/i.test(sql)) {
                const customer = state.customers.find(row =>
                    Number(row.id) === Number(params[1])
                    && (row.business_context || 'event_genix') === params[2]
                );
                if (!customer) return { rows: [], rowCount: 0 };
                if (Number(customer.lead_id) === Number(params[3]) || !customer.child_name) {
                    customer.child_name = params[0];
                }
                return { rows: [customer], rowCount: 1 };
            }
            throw new Error(`Unexpected query: ${sql}`);
        }
    };
    return db;
}

describe('lead customer card repair', () => {
    it('dry-run plans safe repairs without writes', async () => {
        const db = createFakeRepairDb();
        const report = await repairLeadCustomerCards(db, {
            dryRun: true,
            auditReport: cardAuditReport([
                cardAuditResult(),
                cardAuditResult({
                    leadId: 503,
                    classification: 'ok'
                }),
                cardAuditResult({
                    leadId: 502,
                    classification: 'missing_customer_ambiguous_candidates',
                    checks: { sameContextCandidateCount: 2 }
                })
            ])
        });

        assert.equal(report.mode, 'dry-run');
        assert.equal(report.plannedCount, 1);
        assert.equal(report.manualReviewCount, 1);
        assert.equal(report.actions.find(action => action.leadId === 503).action, 'no_op');
        assert.equal(db.queries.length, 0);
    });

    it('apply creates a same-context customer and durable link for no-candidate leads', async () => {
        const db = createFakeRepairDb({
            leads: [{
                id: 501,
                business_context: 'event_genix',
                client_name: 'Lead Client',
                phone: '+38 (097) 111-22-33',
                instagram: '@lead_client',
                source: 'instagram',
                celebrants: [{ name: 'Lead Child', birthday: '2019-01-02' }]
            }]
        });

        const report = await repairLeadCustomerCards(db, {
            apply: true,
            auditReport: cardAuditReport([cardAuditResult()])
        });

        assert.equal(report.repairedCount, 1);
        assert.equal(report.repaired[0].result.mode, 'created_new');
        assert.equal(db.state.customers.length, 1);
        assert.equal(db.state.customers[0].business_context, 'event_genix');
        assert.equal(db.state.customers[0].lead_id, 501);
        assert.equal(db.state.links[0].lead_id, 501);
        assert.equal(db.state.links[0].customer_id, db.state.customers[0].id);
    });

    it('apply links only a single same-context candidate', async () => {
        const db = createFakeRepairDb({
            leads: [{ id: 501, business_context: 'event_genix', client_name: 'Lead Client', phone: '+380971112233' }],
            customers: [{ id: 701, business_context: 'event_genix', name: 'Existing Client', phone: '+380971112233', notes: null }]
        });

        const report = await repairLeadCustomerCards(db, {
            apply: true,
            auditReport: cardAuditReport([
                cardAuditResult({
                    classification: 'missing_customer_single_candidate',
                    candidateCustomers: [{ id: 701, businessContext: 'event_genix', match: 'phone' }],
                    checks: {
                        hasWrongBusinessContext: false,
                        hasBrokenLeadCustomerLink: false,
                        sameContextCandidateCount: 1
                    }
                })
            ])
        });

        assert.equal(report.repairedCount, 1);
        assert.equal(report.repaired[0].result.mode, 'linked_existing');
        assert.equal(db.state.links[0].customer_id, 701);
        assert.equal(db.state.customers[0].lead_id, 501);
    });

    it('blocks cross-business candidates and ambiguous candidates', () => {
        const actions = planLeadCustomerCardRepairs(cardAuditReport([
            cardAuditResult({
                classification: 'missing_customer_single_candidate',
                candidateCustomers: [{ id: 701, businessContext: 'dar', match: 'phone' }],
                checks: {
                    hasWrongBusinessContext: true,
                    hasBrokenLeadCustomerLink: false,
                    sameContextCandidateCount: 1
                }
            }),
            cardAuditResult({
                leadId: 502,
                classification: 'missing_customer_ambiguous_candidates',
                candidateCustomers: [
                    { id: 801, businessContext: 'event_genix', match: 'phone' },
                    { id: 802, businessContext: 'event_genix', match: 'instagram' }
                ],
                checks: {
                    hasWrongBusinessContext: false,
                    hasBrokenLeadCustomerLink: false,
                    sameContextCandidateCount: 2
                }
            })
        ]));

        assert.deepEqual(actions.map(action => action.action), ['manual_review', 'manual_review']);
    });
});

describe('lead customer children repair', () => {
    it('replaces same lead-owned rows while preserving manual and other-lead children', async () => {
        const db = createFakeRepairDb({
            leads: [{
                id: 501,
                business_context: 'event_genix',
                client_name: 'Lead Client',
                celebrants: [
                    { name: 'New Child', birthday: '2019-01-02' },
                    { name: 'Second Child' }
                ]
            }],
            customers: [{ id: 701, business_context: 'event_genix', name: 'Customer', lead_id: 501, child_name: null }],
            children: [
                { id: 1, business_context: 'event_genix', customer_id: 701, lead_id: null, name: 'Manual Child', source_kind: 'customer_api', source_payload: {}, sort_order: 0 },
                { id: 2, business_context: 'event_genix', customer_id: 701, lead_id: 501, name: 'Old Lead Child', source_kind: 'lead_celebrant', source_payload: {}, sort_order: 10 },
                { id: 3, business_context: 'event_genix', customer_id: 701, lead_id: 502, name: 'Other Lead Child', source_kind: 'lead_celebrant', source_payload: {}, sort_order: 10 }
            ]
        });

        const report = await repairLeadCustomerChildren(db, {
            apply: true,
            auditReport: childrenAuditReport([{
                leadId: 501,
                customerId: 701,
                businessContext: 'event_genix',
                classification: 'missing_customer_child',
                missingChildCount: 2
            }])
        });

        assert.equal(report.repairedCount, 1);
        assert.deepEqual(db.state.children.map(child => child.name).sort(), [
            'Manual Child',
            'New Child',
            'Other Lead Child',
            'Second Child'
        ]);
        assert.ok(!db.state.children.some(child => child.name === 'Old Lead Child'));
        const synced = db.state.children.filter(child => child.source_kind === 'lead_celebrant' && Number(child.lead_id) === 501);
        assert.deepEqual(synced.map(child => child.name).sort(), ['New Child', 'Second Child']);
        assert.equal(db.state.customers[0].child_name, 'New Child');
    });

    it('does not sync children across business contexts', async () => {
        const db = createFakeRepairDb({
            leads: [{ id: 501, business_context: 'event_genix', celebrants: [{ name: 'Child' }] }],
            customers: [{ id: 701, business_context: 'dar', name: 'Foreign Customer', lead_id: 501 }],
            children: []
        });

        const report = await repairLeadCustomerChildren(db, {
            apply: true,
            auditReport: childrenAuditReport([{
                leadId: 501,
                customerId: 701,
                businessContext: 'event_genix',
                classification: 'missing_customer_child',
                missingChildCount: 1
            }])
        });

        assert.equal(report.repairedCount, 0);
        assert.equal(report.skipped[0].reason, 'customer_not_found_or_context_mismatch');
        assert.ok(!db.queries.some(query => /INSERT INTO customer_children/i.test(query.sql)));
    });
});

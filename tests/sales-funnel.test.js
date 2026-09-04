/**
 * tests/sales-funnel.test.js — v29.1.0 Sales Funnel tests
 * Lead types, pipeline stages, customer cards, mailing list, payment
 */
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { authRequest, TEST_PASS, TEST_USER } = require('./helpers');

let testLeadId;
const ROOT = path.resolve(__dirname, '..');
const liveDescribe = TEST_USER && TEST_PASS ? describe : describe.skip;

describe('Sales Funnel deposit_received local regression', () => {
    it('normalizes the legacy /leads.html path to /sales-funnel', () => {
        const leadsPage = fs.readFileSync(path.join(ROOT, 'js', 'leads-page.js'), 'utf8');
        const routeStart = leadsPage.indexOf('function normalizeLeadCanonicalRoute()');
        const routeEnd = leadsPage.indexOf('function syncLeadUrlState(', routeStart);
        const routeCode = leadsPage.slice(routeStart, routeEnd);

        assert.ok(routeStart >= 0 && routeEnd > routeStart, 'canonical route normalizer is missing');
        assert.match(routeCode, /if \(currentPath !== '\/leads'\) return;/);
        assert.match(routeCode, /url\.pathname = '\/sales-funnel';/);
        assert.match(routeCode, /window\.history\.replaceState\(/);
    });

    it('sales funnel startup does not bounce valid users away on API 403', () => {
        const leadsPage = fs.readFileSync(path.join(ROOT, 'js', 'leads-page.js'), 'utf8');

        assert.match(
            leadsPage,
            /const currentPath = window\.location\.pathname\.replace\(\/\\\/\$\/, ''\)\.replace\(\/\\\.html\$\/i, ''\) \|\| '\/';/
        );
        assert.match(
            leadsPage,
            /if \(res\.status === 403\) \{[\s\S]*throw new Error\(message\);\s*\}/
        );
        assert.doesNotMatch(
            leadsPage,
            /if \(res\.status === 403\) \{[^}]*window\.location\.href = '\/'/
        );
        assert.doesNotMatch(leadsPage, /localStorage\.getItem\(['"]pzp_token['"]\)/);
        assert.match(leadsPage, /user = await resolveLeadAuthenticatedUser\(\)/);
        assert.match(leadsPage, /if \(!leadAuthRedirectHandled\) window\.location\.href = '\/'/);
        assert.match(leadsPage, /showLeadBootstrapError\(error\);\s*return;/);
        assert.match(leadsPage, /apiFetchWithAuthRetry\(leadApiUrl\(url\)/);
        assert.match(leadsPage, /isApiAuthSessionFailureTransient\(authFailure\)/);
        assert.doesNotMatch(leadsPage, /if \(!res\) \{\s*window\.location\.href = '\/'/);
    });

    it('deposit_received stage transition is wired to the accountant banquet deposit hook', () => {
        const leadsRoute = fs.readFileSync(path.join(ROOT, 'routes', 'leads.js'), 'utf8');
        assert.match(leadsRoute, /oldStage !== 'deposit_received'/);
        assert.match(leadsRoute, /newStage === 'deposit_received'/);
        assert.match(leadsRoute, /onDepositReceived\(updatedLead, req\.user/);
        assert.match(leadsRoute, /createAccountantDepositTaskOnce/);
        assert.match(leadsRoute, /source_type: 'banquet_deposit'/);
        assert.match(leadsRoute, /duplicateMode: 'skip'/);
    });

    it('deal customer conversion syncs every lead celebrant into customer_children', () => {
        const leadsRoute = fs.readFileSync(path.join(ROOT, 'routes', 'leads.js'), 'utf8');
        const routeSmoke = fs.readFileSync(path.join(ROOT, 'tests', 'route-smoke.test.js'), 'utf8');

        assert.match(leadsRoute, /function leadCustomerChildren\(lead = \{\}\)/);
        assert.match(leadsRoute, /const children = leadCustomerChildren\(lead\);[\s\S]*replaceCustomerChildren\(\s*customerId,\s*children,/);
        assert.match(leadsRoute, /const legacyChildSnapshot = buildLegacyChildSnapshot\(children,/);
        assert.match(leadsRoute, /original_lead_child_name_snapshot: legacyChildSnapshot\.childName/);
        assert.match(leadsRoute, /sourceKind: 'lead_celebrant'/);
        assert.match(leadsRoute, /sourceLeadId: leadId/);
        assert.match(leadsRoute, /sortOrderBase: 10/);
        assert.doesNotMatch(leadsRoute, /leadCustomerChildren\(lead\)\s*\[\s*0\s*\]/);
        assert.match(routeSmoke, /const childInserts = queries\.filter\(q => \/INSERT INTO customer_children\/i\.test\(q\.text\)\);/);
        assert.match(routeSmoke, /assert\.equal\(childInserts\.length, 3\)/);
        assert.match(routeSmoke, /assert\.deepEqual\(childInserts\.map\(q => q\.params\[4\]\), \['Anna', 'Bohdan', 'Sofia'\]\)/);
    });
});

liveDescribe('Sales Funnel v29.1.0 — Lead Types & Pipeline', () => {
    before(async () => {
        const res = await authRequest('POST', '/api/leads', {
            client_name: 'Funnel Test Client',
            phone: '+380999887766',
            source: 'test'
        });
        if (res.status === 200 && res.data?.lead) {
            testLeadId = res.data.lead.id;
        }
    });

    it('POST /api/leads — creates lead', () => {
        assert.ok(testLeadId, 'Lead was created');
    });

    it('PATCH lead_type to quality + category', async () => {
        if (!testLeadId) return;
        const res = await authRequest('PATCH', `/api/leads/${testLeadId}`, {
            lead_type: 'quality',
            quality_category: 'birthday'
        });
        assert.equal(res.status, 200);
        assert.equal(res.data.lead.lead_type, 'quality');
        assert.equal(res.data.lead.quality_category, 'birthday');
    });

    it('PATCH lead_type to spam', async () => {
        if (!testLeadId) return;
        const res = await authRequest('PATCH', `/api/leads/${testLeadId}`, {
            lead_type: 'spam'
        });
        assert.equal(res.status, 200);
        assert.equal(res.data.lead.lead_type, 'spam');
    });

    it('PATCH pipeline_stage to contacted', async () => {
        if (!testLeadId) return;
        const res = await authRequest('PATCH', `/api/leads/${testLeadId}`, {
            lead_type: 'quality',
            pipeline_stage: 'contacted'
        });
        assert.equal(res.status, 200);
        assert.equal(res.data.lead.pipeline_stage, 'contacted');
    });

    it('PATCH pipeline_stage to deposit_received', async () => {
        if (!testLeadId) return;
        const res = await authRequest('PATCH', `/api/leads/${testLeadId}`, {
            pipeline_stage: 'deposit_received',
            quality_category: 'birthday'
        });
        assert.equal(res.status, 200);
        assert.equal(res.data.lead.pipeline_stage, 'deposit_received');
    });

    it('PATCH pipeline_stage to lost with reason', async () => {
        if (!testLeadId) return;
        const res = await authRequest('PATCH', `/api/leads/${testLeadId}`, {
            pipeline_stage: 'lost',
            lost_reason: 'Дорого: тестова причина'
        });
        assert.equal(res.status, 200);
        assert.equal(res.data.lead.pipeline_stage, 'lost');
    });

    it('GET /api/leads?lead_type=quality — filters by type', async () => {
        const res = await authRequest('GET', '/api/leads?lead_type=quality');
        assert.equal(res.status, 200);
        assert.ok(res.data.leads);
    });

    it('GET /api/leads/stats — includes type and stage stats', async () => {
        const res = await authRequest('GET', '/api/leads/stats');
        assert.equal(res.status, 200);
        assert.ok(res.data.typeStats);
        assert.ok(res.data.stageStats);
        assert.ok(typeof res.data.total === 'number');
    });

    it('GET /api/leads/stats?period=today — filters by period', async () => {
        const res = await authRequest('GET', '/api/leads/stats?period=today');
        assert.equal(res.status, 200);
        assert.ok(res.data.typeStats);
    });

    it('GET /api/leads/pipeline — returns stages + leads', async () => {
        const res = await authRequest('GET', '/api/leads/pipeline');
        assert.equal(res.status, 200);
        assert.ok(res.data.pipeline);
        assert.ok(Array.isArray(res.data.leads));
        assert.ok('new' in res.data.pipeline);
        assert.ok('deposit_received' in res.data.pipeline);
    });
});

liveDescribe('Sales Funnel v29.1.0 — Customer Cards', () => {
    it('POST /api/leads/:id/card — saves legacy card fields into the real customer card', async () => {
        if (!testLeadId) return;
        const res = await authRequest('POST', `/api/leads/${testLeadId}/card`, {
            event_type: 'birthday',
            event_date: '2026-04-15',
            guest_count: 20,
            children_count: 12,
            budget_approx: 8000,
            how_found: 'Instagram',
            email: 'test@example.com',
            channel: 'telegram',
            notes: 'Тестова картка'
        });
        assert.equal(res.status, 200);
        assert.equal(res.data.deprecated, true);
        assert.equal(res.data.source, 'customers');
        assert.ok(res.data.card);
        assert.ok(res.data.customer);
        assert.equal(res.data.customer.leadId, testLeadId);
        assert.equal(res.data.card.customer_id, res.data.customer.id);
        assert.equal(res.data.card.event_date, '2026-04-15');
        assert.match(res.data.customer.notes || '', new RegExp(`legacy customer_card:lead:${testLeadId}`));
        assert.match(res.data.customer.notes || '', /8000/);
    });

    it('GET /api/leads/:id/card — returns a customers-backed compat card', async () => {
        if (!testLeadId) return;
        const res = await authRequest('GET', `/api/leads/${testLeadId}/card`);
        assert.equal(res.status, 200);
        assert.equal(res.data.deprecated, true);
        assert.equal(res.data.source, 'customers');
        assert.ok(res.data.card);
        assert.ok(res.data.customer);
        assert.equal(res.data.card.customer_id, res.data.customer.id);
        assert.equal(res.data.card.event_date, '2026-04-15');
    });

    it('POST /api/leads/:id/card — updates the compat note block without touching customer_cards', async () => {
        if (!testLeadId) return;
        const res = await authRequest('POST', `/api/leads/${testLeadId}/card`, {
            event_type: 'corporate',
            event_date: '2026-05-01',
            budget_approx: 15000
        });
        assert.equal(res.status, 200);
        assert.equal(res.data.source, 'customers');
        assert.equal(res.data.card.event_date, '2026-05-01');
        assert.match(res.data.customer.notes || '', /15000/);
    });

    it('GET /api/leads/999999/card — returns null card', async () => {
        const res = await authRequest('GET', '/api/leads/999999/card');
        assert.equal(res.status, 200);
        assert.equal(res.data.card, null);
    });

    it('POST /api/leads/999999/card — returns 404', async () => {
        const res = await authRequest('POST', '/api/leads/999999/card', {
            event_type: 'birthday'
        });
        assert.equal(res.status, 404);
    });
});

liveDescribe('Sales Funnel v29.1.0 — Mailing List', () => {
    let mailingId;

    it('POST /api/leads/mailing — adds to mailing list', async () => {
        const res = await authRequest('POST', '/api/leads/mailing', {
            name: 'Test Mailing',
            phone: '+380998887700',
            email: 'mail@test.com',
            source_channel: 'telegram',
            notes: 'Test note'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.entry);
        mailingId = res.data.entry.id;
    });

    it('POST /api/leads/mailing — upserts on same phone', async () => {
        const res = await authRequest('POST', '/api/leads/mailing', {
            name: 'Updated Name',
            phone: '+380998887700',
            email: 'new@test.com'
        });
        assert.equal(res.status, 200);
        assert.equal(res.data.entry.email, 'new@test.com');
    });

    it('POST /api/leads/mailing — requires name or phone', async () => {
        const res = await authRequest('POST', '/api/leads/mailing', {});
        assert.equal(res.status, 400);
    });

    it('GET /api/leads/mailing — returns list', async () => {
        const res = await authRequest('GET', '/api/leads/mailing');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.list));
        assert.ok(res.data.list.length > 0);
    });

    it('DELETE /api/leads/mailing/:id — removes entry', async () => {
        if (!mailingId) return;
        const res = await authRequest('DELETE', `/api/leads/mailing/${mailingId}`);
        assert.equal(res.status, 200);
    });

    it('DELETE /api/leads/mailing/999999 — returns 404', async () => {
        const res = await authRequest('DELETE', '/api/leads/mailing/999999');
        assert.equal(res.status, 404);
    });
});

liveDescribe('Sales Funnel v29.1.0 — Version & Payment', () => {
    it('GET /api/version — returns version info', async () => {
        const res = await authRequest('GET', '/api/version');
        assert.equal(res.status, 200);
        assert.ok(res.data.version);
        assert.equal(typeof res.data.testMode, 'boolean');
    });

    it('PATCH /api/bookings/:id/payment — requires fields', async () => {
        const res = await authRequest('PATCH', '/api/bookings/BK-9999-9999/payment', {});
        assert.equal(res.status, 400);
    });

    it('PATCH /api/bookings/:id/payment — updates payment method', async () => {
        // Get a real booking
        const today = new Date().toISOString().split('T')[0];
        const bookings = await authRequest('GET', `/api/bookings/${today}`);
        if (bookings.status !== 200 || !bookings.data?.length) return;

        const id = bookings.data[0].id;
        const res = await authRequest('PATCH', `/api/bookings/${id}/payment`, {
            payment_method: 'cash',
            fiscal_required: true
        });
        assert.equal(res.status, 200);
        assert.equal(res.data.booking.payment_method, 'cash');
        assert.equal(res.data.booking.fiscal_required, true);
    });
});

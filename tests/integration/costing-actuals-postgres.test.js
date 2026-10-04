'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { Pool } = require('pg');
const { assertCostingCompositionReady } = require('../../services/costingCompositionStartupGuard');

test('actual provenance, correction, completion, business scope and group aggregate in disposable PostgreSQL', {
    skip: !process.env.COSTING_TEST_PG_PORT, timeout: 120000
}, async () => {
    assert.notEqual(process.env.NODE_ENV, 'production');
    for (const key of ['RAILWAY_ENVIRONMENT', 'RAILWAY_PROJECT_ID', 'RAILWAY_SERVICE_ID']) assert.ok(!process.env[key]);
    const connection = { host: '127.0.0.1', port: Number(process.env.COSTING_TEST_PG_PORT), user: 'postgres',
        password: process.env.COSTING_TEST_PG_PASSWORD, ssl: false, connectionTimeoutMillis: 5000 };
    assert.ok(Number.isInteger(connection.port) && connection.port > 1024 && connection.password?.length >= 12);
    const name = `eventgenix_costing_actual_${crypto.randomUUID().replaceAll('-', '')}`;
    const admin = new Pool({ ...connection, database: 'postgres', max: 1 });
    let pool;
    let server;
    let created = false;
    const cachePaths = ['../../db', '../../routes/finance-costing', '../../routes/finance-costing-actual'].map(require.resolve);
    const savedCache = cachePaths.map(key => require.cache[key]);
    try {
        await admin.query(`CREATE DATABASE "${name}"`);
        created = true;
        pool = new Pool({ ...connection, database: name, max: 5 });
        for (const migration of ['375_universal_costing_plan_foundation.sql', '376_costing_actual_provenance.sql']) {
            await pool.query(fs.readFileSync(path.join(__dirname, '../../db/migrations', migration), 'utf8'));
        }
        const legacyTemplate = await pool.query("INSERT INTO costing_templates (business_context,name,kind) VALUES ('event_genix','Legacy group','service') RETURNING id");
        const legacyVersion = await pool.query(
            "INSERT INTO costing_template_versions (business_context,template_id,version_number,effective_from,definition) VALUES ('event_genix',$1,1,'2026-01-01','{}'::jsonb) RETURNING id",
            [legacyTemplate.rows[0].id]
        );
        const legacyPlan = await pool.query(
            `INSERT INTO costing_plan_snapshots (business_context,template_version_id,client_key,execution_kind,execution_label,
             execution_date,inputs,result,revenue_minor,direct_cost_minor,contribution_minor,margin_bps)
             VALUES ('event_genix',$1,$2::uuid,'service','Legacy execution','2026-10-12','{}'::jsonb,'{}'::jsonb,10000,2000,8000,8000) RETURNING id`,
            [legacyVersion.rows[0].id, crypto.randomUUID()]
        );
        await pool.query(fs.readFileSync(path.join(__dirname, '../../db/migrations/377_costing_group_composition_revisions.sql'), 'utf8'));
        await pool.query(fs.readFileSync(path.join(__dirname, '../../db/migrations/379_costing_execution_booking_identity.sql'), 'utf8'));
        assert.equal((await pool.query('SELECT booking_id FROM costing_plan_snapshots WHERE id=$1',
            [legacyPlan.rows[0].id])).rows[0].booking_id, null, 'older plans are not assigned a booking by migration');
        await pool.query(`
            CREATE TABLE bookings (id VARCHAR(50) PRIMARY KEY, business_context VARCHAR(64), price INTEGER, status TEXT);
            CREATE TABLE education_attendance (id BIGINT PRIMARY KEY, business_context VARCHAR(64), booking_id VARCHAR(50), status TEXT);
            CREATE TABLE payroll_reports (id BIGINT PRIMARY KEY, status TEXT, finance_transaction_id INTEGER);
            CREATE TABLE payroll_installments (id BIGINT PRIMARY KEY, payroll_report_id BIGINT, business_context VARCHAR(64),
                locked_amount INTEGER, workflow_status TEXT, allocation_status TEXT);
            CREATE TABLE fiscal_profiles (id BIGINT PRIMARY KEY, crm_profile_key VARCHAR(64));
            CREATE TABLE payment_orders (id BIGINT PRIMARY KEY, fiscal_profile_id BIGINT, total_amount_minor BIGINT,
                status TEXT, payment_status TEXT, source_type TEXT, source_id TEXT);
            CREATE TABLE payment_refunds (id BIGINT PRIMARY KEY, fiscal_profile_id BIGINT, amount_minor BIGINT,
                status TEXT, payment_order_id BIGINT);
            INSERT INTO bookings VALUES ('booking-park', 'event_genix', 250, 'confirmed'), ('booking-dar', 'dar', 900, 'confirmed');
            INSERT INTO education_attendance VALUES (11, 'event_genix', 'booking-park', 'present');
            INSERT INTO payroll_reports VALUES (21, 'approved', NULL);
            INSERT INTO payroll_installments VALUES (31, 21, 'event_genix', 300, 'approved', 'single');
            INSERT INTO fiscal_profiles VALUES (41, 'event_genix'), (42, 'dar');
            INSERT INTO payment_orders VALUES (51, 41, 200000, 'payment_recorded', 'recorded', 'booking', 'booking-park'),
                                              (52, 42, 90000, 'payment_recorded', 'recorded', 'booking', 'booking-dar');
            INSERT INTO payment_refunds VALUES (61, 41, 30000, 'money_refunded', 51);
        `);
        require.cache[cachePaths[0]] = { id: cachePaths[0], filename: cachePaths[0], loaded: true, exports: { pool } };
        delete require.cache[cachePaths[1]];
        delete require.cache[cachePaths[2]];
        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => {
            req.user = { username: 'costing_actual_fixture', role: 'creator', businessContexts: ['event_genix'] };
            next();
        });
        app.use('/api/finance/costing', require('../../routes/finance-costing'));
        server = await new Promise(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
        const origin = `http://127.0.0.1:${server.address().port}/api/finance/costing`;
        async function request(method, endpoint, body, context = 'event_genix') {
            const response = await fetch(origin + endpoint, { method, signal: AbortSignal.timeout(10000),
                headers: { 'Content-Type': 'application/json', 'X-Business-Context': context },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
            return { status: response.status, body: await response.json() };
        }
        async function plan(kind, name, definition, inputs) {
            const template = await request('POST', '/templates', { name, kind, effectiveFrom: '2026-01-01', definition });
            assert.equal(template.status, 201, JSON.stringify(template.body));
            const saved = await request('POST', '/plans', { templateId: template.body.template.id,
                executionDate: '2026-10-12', executionLabel: name, inputs,
                expectedVersionId: template.body.version.id, clientKey: crypto.randomUUID() });
            assert.equal(saved.status, 201, JSON.stringify(saved.body));
            return saved.body.planId;
        }
        const links = [
            { type: 'booking', sourceId: 'booking-park', expectedAmountMinor: '25000' },
            { type: 'education_attendance', sourceId: '11' },
            { type: 'payroll_installment', sourceId: '31', expectedAmountMinor: '30000' },
            { type: 'payment_order', sourceId: '51', expectedAmountMinor: '200000' },
            { type: 'payment_refund', sourceId: '61', expectedAmountMinor: '-30000' }
        ];
        for (const link of links) {
            const preview = await request('POST', '/actual/source-links/preview', link);
            assert.equal(preview.status, 200, JSON.stringify(preview.body));
            assert.equal(preview.body.preview.referenceValid, true);
            assert.equal(preview.body.preview.postingAllowed, false);
            assert.deepEqual(preview.body.preview.verifiedFields,
                link.type === 'education_attendance' ? ['id', 'business_context'] : ['id', 'business_context', 'amount']);
            assert.equal(preview.body.preview.amountMatches, link.type === 'education_attendance' ? null : true);
        }
        const foreignSource = await request('POST', '/actual/source-links/preview',
            { type: 'payment_order', sourceId: '52', expectedAmountMinor: '90000' });
        assert.equal(foreignSource.body.preview.referenceValid, false);
        assert.deepEqual(foreignSource.body.preview.verifiedFields, []);
        assert.equal(Object.hasOwn(foreignSource.body.preview, 'canonicalAmountMinor'), false);
        assert.equal((await request('POST', '/actual/source-links/preview',
            { type: 'payment_order', sourceId: '51', expectedAmountMinor: '199999' })).body.preview.referenceValid, false);
        assert.equal((await request('POST', '/actual/source-links/preview',
            { type: 'education_attendance', sourceId: '11', expectedAmountMinor: '0' })).status, 400);
        assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM costing_actual_sources')).rows[0].count, 0);
        const rentalId = await plan('rental', 'Room B', { revenueBasis: 'hour', revenueRateMinor: '60000', lines: [
            { code: 'cleaning', label: 'Cleaning', basis: 'execution', rateMinor: '18000' },
            { code: 'host', label: 'Host estimate', basis: 'execution', rateMinor: '28000' },
            { code: 'materials', label: 'Materials', basis: 'execution', rateMinor: '18000' },
            { code: 'fee', label: 'Fee', basis: 'percent', percentBps: 400, percentBase: 'revenue' }
        ] }, { durationMinutes: 210, discountMinor: '10000' });
        const agencyId = await plan('agency_order', 'Agency C', { revenueBasis: 'execution', revenueRateMinor: '1000000', lines: [
            { code: 'venue', label: 'Venue', basis: 'execution', rateMinor: '200000' }
        ] }, {});
        const concurrent = { externalId: 'agency_zero_line', economicRole: 'misc_cost', category: 'direct_cost',
            amountMinor: '0', evidenceState: 'confirmed', semantic: 'cost' };
        const both = await Promise.all([request('POST', `/actual/plans/${agencyId}/sources`, concurrent),
            request('POST', `/actual/plans/${agencyId}/sources`, concurrent)]);
        assert.deepEqual(both.map(result => result.status).sort(), [200, 201]);
        assert.equal((await request('GET', `/actual/plans/${agencyId}`)).body.sources.length, 1);
        const actualPath = `/actual/plans/${rentalId}`;
        const empty = await request('GET', actualPath);
        assert.equal(empty.body.summary.actualContributionMinor, null);
        assert.equal(empty.body.summary.revenue.status, 'missing');
        const revenue = { externalId: 'payment_b', economicRole: 'rental_sale', category: 'revenue',
            amountMinor: '200000', evidenceState: 'confirmed', semantic: 'charge' };
        const posted = await request('POST', `${actualPath}/sources`, revenue);
        assert.equal(posted.status, 201, JSON.stringify(posted.body));
        const retry = await request('POST', `${actualPath}/sources`, revenue);
        assert.equal(retry.status, 200);
        assert.equal(retry.body.idempotent, true);
        assert.equal((await request('POST', `${actualPath}/sources`, { ...revenue, amountMinor: '210000' })).status, 409);
        assert.equal((await request('POST', `${actualPath}/sources`, { ...revenue, economicRole: 'second_sale' })).status, 409);
        assert.equal((await request('POST', `/actual/plans/${agencyId}/sources`, revenue)).status, 409);
        assert.equal((await request('GET', actualPath, undefined, 'dar')).status, 403);
        const addCost = (externalId, economicRole, amountMinor, evidenceState = 'confirmed') =>
            request('POST', `${actualPath}/sources`, { externalId, economicRole, category: 'direct_cost',
                amountMinor, evidenceState, semantic: 'cost' });
        assert.equal((await addCost('cleaning_b', 'cleaning', '18000')).status, 201);
        const host = await addCost('host_b', 'host_pay', '28000', 'estimate');
        assert.equal(host.status, 201);
        assert.equal((await addCost('materials_b', 'materials', '18000')).status, 201);
        assert.equal((await addCost('fee_b', 'platform_fee', '8000')).status, 201);
        const partial = await request('GET', actualPath);
        assert.equal(partial.body.summary.directCost.estimateMinor, '28000');
        assert.equal(partial.body.summary.actualContributionMinor, null);
        assert.equal((await request('POST', `${actualPath}/completions`, { category: 'direct_cost',
            isComplete: true, reason: 'Premature while host is only estimated' })).status, 409);
        const corrected = await request('POST', `/actual/sources/${host.body.sourceId}/correct`, {
            amountMinor: '30000', evidenceState: 'confirmed', semantic: 'cost',
            reason: 'Synthetic payroll fact supersedes the host estimate'
        });
        assert.equal(corrected.status, 201, JSON.stringify(corrected.body));
        const afterCorrection = await request('GET', actualPath);
        assert.equal(afterCorrection.body.summary.directCost.confirmedMinor, '74000');
        assert.equal(afterCorrection.body.entries.filter(entry => String(entry.source_id) === String(host.body.sourceId)).length, 3);
        assert.equal(afterCorrection.body.summary.actualContributionMinor, null);
        for (const category of ['revenue', 'direct_cost']) {
            const done = await request('POST', `${actualPath}/completions`, { category, isComplete: true, reason: 'Synthetic reconciliation checked' });
            assert.equal(done.status, 201, JSON.stringify(done.body));
        }
        const complete = await request('GET', actualPath);
        assert.equal(complete.body.summary.actualContributionMinor, '126000');
        assert.equal(complete.body.summary.actualMarginBps, 6300);
        assert.equal(complete.body.summary.contributionVarianceMinor, '-2000');
        const bridge = await request('GET', `${actualPath}/reconciliation`);
        assert.equal(bridge.status, 200);
        assert.equal(bridge.body.preview.postingAllowed, false);
        assert.ok(bridge.body.preview.candidates.every(candidate => candidate.postingAllowed === false));
        const refund = await request('POST', `${actualPath}/sources`, { externalId: 'refund_b', economicRole: 'rental_refund',
            category: 'revenue', amountMinor: '-30000', evidenceState: 'confirmed', semantic: 'refund' });
        assert.equal(refund.status, 201);
        assert.equal((await request('GET', actualPath)).body.summary.actualContributionMinor, null,
            'new evidence invalidates the prior completion attestation');
        assert.equal((await request('POST', `${actualPath}/completions`, { category: 'revenue', isComplete: true,
            reason: 'Refund included in revised revenue' })).status, 201);
        const afterRefund = await request('GET', actualPath);
        assert.equal(afterRefund.body.summary.revenue.confirmedMinor, '170000');
        assert.equal(afterRefund.body.summary.actualContributionMinor, '96000');
        assert.equal(afterRefund.body.summary.actualMarginBps, 5647);
        assert.equal((await request('POST', `${actualPath}/sources`, { externalId: 'zero_adjustment_b', economicRole: 'revenue_adjustment',
            category: 'revenue', amountMinor: '0', evidenceState: 'confirmed', semantic: 'adjustment' })).status, 201);
        assert.equal((await request('GET', actualPath)).body.summary.actualContributionMinor, null);
        assert.equal((await request('POST', `${actualPath}/completions`, { category: 'revenue', isComplete: true,
            reason: 'Explicit zero adjustment reviewed' })).status, 201);
        assert.equal((await request('GET', actualPath)).body.summary.actualContributionMinor, '96000');
        assert.equal((await request('POST', `${actualPath}/sources`, { externalId: 'bad_negative', economicRole: 'sale',
            category: 'revenue', amountMinor: '-1000', evidenceState: 'confirmed', semantic: 'charge' })).status, 400);

        const grouped = await request('POST', '/actual/groups', { kind: 'course', label: 'Course fixture', members: [
            { planId: rentalId, includePlanRevenue: true, includePlanDirectCost: false },
            { planId: agencyId, includePlanRevenue: false, includePlanDirectCost: true }
        ] });
        assert.equal(grouped.status, 201, JSON.stringify(grouped.body));
        await assertCostingCompositionReady(pool);
        assert.equal((await request('POST', '/actual/groups', { kind: 'course', label: 'Repeated in request', members: [
            { planId: rentalId, includePlanRevenue: true, includePlanDirectCost: false },
            { planId: rentalId, includePlanRevenue: false, includePlanDirectCost: true }
        ] })).status, 400);
        assert.equal((await request('POST', '/actual/groups', { kind: 'course', label: 'Nested group', members: [
            { planId: rentalId, groupId: grouped.body.groupId, includePlanRevenue: true, includePlanDirectCost: true }
        ] })).status, 400);
        assert.equal((await request('POST', '/actual/groups', { kind: 'course', label: 'No contribution', members: [
            { planId: rentalId, includePlanRevenue: false, includePlanDirectCost: false }
        ] })).status, 400);
        const darTemplate = await pool.query("INSERT INTO costing_templates (business_context,name,kind) VALUES ('dar','Other business','service') RETURNING id");
        const darVersion = await pool.query(
            "INSERT INTO costing_template_versions (business_context,template_id,version_number,effective_from,definition) VALUES ('dar',$1,1,'2026-01-01','{}'::jsonb) RETURNING id",
            [darTemplate.rows[0].id]
        );
        const darPlan = await pool.query(
            `INSERT INTO costing_plan_snapshots (business_context,template_version_id,client_key,execution_kind,execution_label,
             execution_date,inputs,result,revenue_minor,direct_cost_minor,contribution_minor,margin_bps)
             VALUES ('dar',$1,$2::uuid,'service','Dar execution','2026-10-12','{}'::jsonb,'{}'::jsonb,10000,2000,8000,8000) RETURNING id`,
            [darVersion.rows[0].id, crypto.randomUUID()]
        );
        assert.equal((await request('POST', '/actual/groups', { kind: 'course', label: 'Cross-business', members: [
            { planId: darPlan.rows[0].id, includePlanRevenue: true, includePlanDirectCost: true }
        ] })).status, 404);
        const group = await request('GET', `/actual/groups/${grouped.body.groupId}`);
        assert.equal(group.body.summary.planned.revenueMinor, '200000');
        assert.equal(group.body.summary.planned.directCostMinor, '200000');
        assert.equal(group.body.summary.planned.contributionMinor, '0');
        assert.equal(group.body.summary.actualContributionMinor, null);
        assert.equal((await request('POST', `/actual/groups/${grouped.body.groupId}/sources`, revenue)).status, 409);
        assert.equal((await request('POST', `/actual/plans/${agencyId}/sources`, { externalId: 'venue_c',
            economicRole: 'venue_cost', category: 'direct_cost', amountMinor: '200000',
            evidenceState: 'confirmed', semantic: 'cost' })).status, 201);
        assert.equal((await request('POST', `/actual/plans/${agencyId}/completions`, { category: 'direct_cost',
            isComplete: true, reason: 'Synthetic venue invoice checked' })).status, 201);
        for (const category of ['revenue', 'direct_cost']) {
            assert.equal((await request('POST', `/actual/groups/${grouped.body.groupId}/completions`, { category,
                isComplete: true, expectedRevision: 1, reason: 'No shared group-level actuals in fixture' })).status, 201);
        }
        const finishedGroup = await request('GET', `/actual/groups/${grouped.body.groupId}`);
        assert.equal(finishedGroup.body.summary.revenue.confirmedMinor, '170000');
        assert.equal(finishedGroup.body.summary.directCost.confirmedMinor, '200000');
        assert.equal(finishedGroup.body.summary.actualContributionMinor, '-30000');
        assert.equal(finishedGroup.body.revision, 1);
        const groupPath = `/actual/groups/${grouped.body.groupId}`;
        const revisionPayload = { expectedRevision: 1, reason: 'Move venue into its own aggregate', members: [
            { planId: rentalId, includePlanRevenue: true, includePlanDirectCost: true }
        ] };
        assert.equal((await request('POST', `${groupPath}/revisions`, { ...revisionPayload, members: [
            { planId: rentalId, includePlanRevenue: true, includePlanDirectCost: true },
            { planId: rentalId, includePlanRevenue: false, includePlanDirectCost: true }
        ] })).status, 400);
        assert.equal((await request('POST', `${groupPath}/revisions`, { ...revisionPayload, members: [
            { groupId: grouped.body.groupId, includePlanRevenue: true, includePlanDirectCost: true }
        ] })).status, 400);
        assert.equal((await request('POST', `${groupPath}/revisions`, { ...revisionPayload, members: [
            { planId: darPlan.rows[0].id, includePlanRevenue: true, includePlanDirectCost: true }
        ] })).status, 404);
        assert.equal((await request('POST', `${groupPath}/revisions`, revisionPayload, 'dar')).status, 403);
        const competing = await Promise.all([
            request('POST', `${groupPath}/revisions`, revisionPayload),
            request('POST', `${groupPath}/revisions`, revisionPayload)
        ]);
        assert.deepEqual(competing.map(result => result.status).sort(), [201, 409]);
        const revised = await request('GET', groupPath);
        assert.equal(revised.body.revision, 2);
        await assertCostingCompositionReady(pool);
        assert.deepEqual(revised.body.history.map(item => item.revision_number), [1, 2]);
        assert.deepEqual(revised.body.history[0].members.map(item => String(item.plan_id)), [String(rentalId), String(agencyId)]);
        assert.deepEqual(revised.body.members.map(item => String(item.planId)), [String(rentalId)]);
        assert.equal(revised.body.summary.actualContributionMinor, null, 'composition change invalidates group attestations');
        assert.equal(revised.body.completions.slice(-2).every(item => item.is_complete === false), true);
        assert.equal((await request('POST', `${groupPath}/completions`, { category: 'revenue', isComplete: true,
            expectedRevision: 1, reason: 'Stale group reconciliation' })).status, 409);
        assert.equal((await request('GET', groupPath)).body.summary.actualContributionMinor, null);
        for (const category of ['revenue', 'direct_cost']) {
            assert.equal((await request('POST', `${groupPath}/completions`, { category, isComplete: true,
                expectedRevision: 2, reason: 'Reviewed revised composition' })).status, 201);
        }
        assert.equal((await request('GET', groupPath)).body.summary.actualContributionMinor, '96000');
        assert.equal((await request('POST', `${groupPath}/revisions`, revisionPayload)).status, 409);
        assert.equal((await request('POST', `${groupPath}/revisions`, { ...revisionPayload,
            expectedRevision: 2 })).status, 409, 'same composition is not appended again');
        const moved = await request('POST', '/actual/groups', { kind: 'session', label: 'Venue aggregate', members: [
            { planId: agencyId, includePlanRevenue: false, includePlanDirectCost: true }
        ] });
        assert.equal(moved.status, 201, JSON.stringify(moved.body));
        await assert.rejects(pool.query('UPDATE costing_group_revisions SET reason=$1 WHERE group_id=$2',
            ['rewrite', grouped.body.groupId]), /immutable/);
        await assert.rejects(pool.query('DELETE FROM costing_group_revision_members WHERE plan_id=$1', [agencyId]), /immutable/);
        for (const kind of ['session', 'day']) {
            const memberId = await plan(kind === 'day' ? 'admission_day' : 'session', `${kind} fixture`,
                { revenueBasis: 'execution', revenueRateMinor: '10000', lines: [
                    { code: 'fixed', label: 'Fixed', basis: 'execution', rateMinor: '2500' }
                ] }, {});
            const createdGroup = await request('POST', '/actual/groups', { kind, label: `${kind} aggregate`, members: [
                { planId: memberId, includePlanRevenue: true, includePlanDirectCost: true }
            ] });
            assert.equal(createdGroup.status, 201);
            const categoryGroup = await request('GET', `/actual/groups/${createdGroup.body.groupId}`);
            assert.equal(categoryGroup.body.summary.planned.revenueMinor, '10000');
            assert.equal(categoryGroup.body.summary.planned.directCostMinor, '2500');
            assert.equal(categoryGroup.body.summary.actualContributionMinor, null);
        }
        assert.equal((await request('POST', '/actual/groups', { kind: 'day', label: 'Duplicate member', members: [
            { planId: rentalId, includePlanRevenue: true, includePlanDirectCost: true }
        ] })).status, 409);
        for (let revision = 0; revision < 6; revision += 1) {
            const [read, correction] = await Promise.all([
                request('GET', actualPath),
                request('POST', `/actual/sources/${host.body.sourceId}/correct`, {
                    amountMinor: revision % 2 ? '30000' : '32000', evidenceState: 'confirmed', semantic: 'cost',
                    reason: `Concurrent snapshot fixture revision ${revision}`
                })
            ]);
            assert.equal(read.status, 200);
            assert.equal(correction.status, 201);
            for (const active of read.body.sources) {
                assert.ok(read.body.entries.some(entry => String(entry.id) === String(active.entry_id) && entry.entry_type === 'record'));
                assert.ok(!read.body.entries.some(entry => String(entry.reverses_entry_id) === String(active.entry_id)));
            }
        }
        await assert.rejects(pool.query('UPDATE costing_actual_entries SET amount_minor=1 WHERE id=$1', [posted.body.entryId]), /immutable/);
        const foreignTemplate = await pool.query("INSERT INTO costing_templates (business_context,name,kind) VALUES ('dar','Foreign list marker','service') RETURNING id");
        const foreignVersion = await pool.query(
            "INSERT INTO costing_template_versions (business_context,template_id,version_number,effective_from,definition) VALUES ('dar',$1,1,'2026-01-01','{}'::jsonb) RETURNING id",
            [foreignTemplate.rows[0].id]
        );
        const foreignPlan = await pool.query(
            `INSERT INTO costing_plan_snapshots (business_context,template_version_id,client_key,execution_kind,execution_label,
             execution_date,inputs,result,revenue_minor,direct_cost_minor,contribution_minor,margin_bps)
             VALUES ('dar',$1,$2::uuid,'service','Foreign list marker','2026-12-31','{}'::jsonb,'{}'::jsonb,999999,0,999999,10000) RETURNING id`,
            [foreignVersion.rows[0].id, crypto.randomUUID()]
        );
        await pool.query(
            `INSERT INTO costing_plan_snapshots (business_context,template_version_id,client_key,execution_kind,execution_label,
             execution_date,inputs,result,revenue_minor,direct_cost_minor,contribution_minor,margin_bps)
             SELECT 'event_genix',$1,('00000000-0000-4000-8000-' || lpad(g::text,12,'0'))::uuid,
                    'service','Batch plan ' || g, DATE '2026-11-01' + (g % 3),
                    '{}'::jsonb,'{}'::jsonb,g * 100,g * 10,g * 90,9000
               FROM generate_series(1,105) AS g`, [legacyVersion.rows[0].id]
        );
        const expectedPlans = (await pool.query(
            `SELECT id::text, revenue_minor::text FROM costing_plan_snapshots
              WHERE business_context='event_genix' ORDER BY execution_date DESC, costing_plan_snapshots.id DESC LIMIT 100`
        )).rows;
        const summaries = await request('GET', '/actual/plans/summaries');
        assert.equal(summaries.status, 200);
        assert.equal(summaries.body.plans.length, 100);
        assert.deepEqual(summaries.body.plans.map(item => item.id), expectedPlans.map(item => item.id));
        assert.deepEqual(summaries.body.plans.map(item => item.summary.planned.revenueMinor),
            expectedPlans.map(item => item.revenue_minor), 'each summary stays aligned with its ordered plan');
        assert.ok(!summaries.body.plans.some(item => item.id === String(foreignPlan.rows[0].id)));
        assert.equal((await request('GET', '/actual/plans/summaries', undefined, 'dar')).status, 403);
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        if (pool) await pool.end();
        cachePaths.forEach((key, index) => { if (savedCache[index]) require.cache[key] = savedCache[index]; else delete require.cache[key]; });
        if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
        await admin.end();
    }
});

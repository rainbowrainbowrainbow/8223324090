'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { Pool } = require('pg');

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
                isComplete: true, reason: 'No shared group-level actuals in fixture' })).status, 201);
        }
        const finishedGroup = await request('GET', `/actual/groups/${grouped.body.groupId}`);
        assert.equal(finishedGroup.body.summary.revenue.confirmedMinor, '170000');
        assert.equal(finishedGroup.body.summary.directCost.confirmedMinor, '200000');
        assert.equal(finishedGroup.body.summary.actualContributionMinor, '-30000');
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
        await assert.rejects(pool.query('UPDATE costing_actual_entries SET amount_minor=1 WHERE id=$1', [posted.body.entryId]), /immutable/);
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        if (pool) await pool.end();
        cachePaths.forEach((key, index) => { if (savedCache[index]) require.cache[key] = savedCache[index]; else delete require.cache[key]; });
        if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
        await admin.end();
    }
});

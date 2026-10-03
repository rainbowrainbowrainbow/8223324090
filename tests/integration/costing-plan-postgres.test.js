'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { Pool } = require('pg');

test('costing version selection, immutable plan and business scope in disposable PostgreSQL', {
    skip: !process.env.COSTING_TEST_PG_PORT, timeout: 120000
}, async () => {
    assert.notEqual(process.env.NODE_ENV, 'production');
    for (const key of ['RAILWAY_ENVIRONMENT', 'RAILWAY_PROJECT_ID', 'RAILWAY_SERVICE_ID']) assert.ok(!process.env[key]);
    const port = Number(process.env.COSTING_TEST_PG_PORT);
    assert.ok(Number.isInteger(port) && port > 1024 && port < 65536);
    const connection = { host: '127.0.0.1', port, user: 'postgres',
        password: process.env.COSTING_TEST_PG_PASSWORD, ssl: false, connectionTimeoutMillis: 5000 };
    assert.ok(connection.password && connection.password.length >= 12);
    const name = `eventgenix_costing_test_${crypto.randomUUID().replaceAll('-', '')}`;
    const admin = new Pool({ ...connection, database: 'postgres', max: 1 });
    let pool;
    let server;
    let created = false;
    const dbPath = require.resolve('../../db');
    const routePath = require.resolve('../../routes/finance-costing');
    const priorDb = require.cache[dbPath];
    const priorRoute = require.cache[routePath];
    try {
        await admin.query(`CREATE DATABASE "${name}"`);
        created = true;
        pool = new Pool({ ...connection, database: name, max: 5 });
        await pool.query(fs.readFileSync(path.join(__dirname, '../../db/migrations/375_universal_costing_plan_foundation.sql'), 'utf8'));
        require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { pool } };
        delete require.cache[routePath];
        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => {
            req.user = { username: 'costing_fixture', role: 'creator', businessContexts: ['event_genix'] };
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
        const definition = { revenueBasis: 'participant', revenueRateMinor: '30000', lines: [
            { code: 'teacher', label: 'Teacher', basis: 'hour', rateMinor: '25000' },
            { code: 'materials', label: 'Materials', basis: 'participant', rateMinor: '4000' }
        ] };
        const createdTemplate = await request('POST', '/templates', {
            name: 'Group lesson', kind: 'lesson', effectiveFrom: '2026-01-01', definition
        });
        assert.equal(createdTemplate.status, 201, JSON.stringify(createdTemplate.body));
        const templateId = createdTemplate.body.template.id;
        const oldVersionId = createdTemplate.body.version.id;
        assert.equal((await pool.query('SELECT business_context FROM costing_templates WHERE id=$1', [templateId])).rows[0].business_context, 'event_genix');

        const otherBusinessRead = await request('GET', `/templates/${templateId}`, undefined, 'dar');
        assert.equal(otherBusinessRead.status, 403);
        const otherBusinessWrite = await request('POST', '/preview', { templateId, executionDate: '2026-10-01', inputs: {} }, 'dar');
        assert.equal(otherBusinessWrite.status, 403);

        const preview = await request('POST', '/preview', {
            templateId, executionDate: '2026-10-12', inputs: { participants: 10, paidParticipants: 8, durationMinutes: 120, discountBps: 1000 }
        });
        assert.equal(preview.status, 200, JSON.stringify(preview.body));
        assert.equal(preview.body.calculation.revenueMinor, '216000');
        assert.equal(preview.body.version.id, oldVersionId);

        const clientKey = crypto.randomUUID();
        const planBody = { templateId, executionDate: '2026-10-12', executionLabel: 'October group lesson',
            inputs: { participants: 10, paidParticipants: 8, durationMinutes: 120, discountBps: 1000 },
            expectedVersionId: oldVersionId, clientKey };
        const saved = await request('POST', '/plans', planBody);
        assert.equal(saved.status, 201, JSON.stringify(saved.body));
        assert.equal(saved.body.calculation.directCostMinor, '90000');
        assert.equal((await request('POST', '/plans', planBody)).status, 409);
        const planRow = (await pool.query('SELECT * FROM costing_plan_snapshots WHERE id=$1', [saved.body.planId])).rows[0];
        assert.equal(planRow.business_context, 'event_genix');
        assert.equal(String(planRow.template_version_id), String(oldVersionId));
        await assert.rejects(pool.query('UPDATE costing_plan_snapshots SET execution_label=$1 WHERE id=$2', ['Changed', saved.body.planId]), /immutable/);

        const revised = await request('POST', `/templates/${templateId}/versions`, {
            effectiveFrom: '2026-11-01', definition: { ...definition, revenueRateMinor: '35000' }
        });
        assert.equal(revised.status, 201, JSON.stringify(revised.body));
        assert.equal(revised.body.version.version_number, 2);
        const oldPreview = await request('POST', '/preview', { templateId, executionDate: '2026-10-12', inputs: { participants: 1, paidParticipants: 1 } });
        const newPreview = await request('POST', '/preview', { templateId, executionDate: '2026-11-12', inputs: { participants: 1, paidParticipants: 1 } });
        assert.equal(oldPreview.body.calculation.revenueMinor, '30000');
        assert.equal(newPreview.body.calculation.revenueMinor, '35000');
        assert.equal((await pool.query('SELECT revenue_minor::text FROM costing_plan_snapshots WHERE id=$1', [saved.body.planId])).rows[0].revenue_minor, '216000');
        await assert.rejects(pool.query('UPDATE costing_template_versions SET effective_from=$1 WHERE id=$2', ['2026-01-02', oldVersionId]), /immutable/);
        const staleSave = await request('POST', '/plans', { ...planBody, executionDate: '2026-11-12', clientKey: crypto.randomUUID() });
        assert.equal(staleSave.status, 409);
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        if (pool) await pool.end();
        if (priorDb) require.cache[dbPath] = priorDb; else delete require.cache[dbPath];
        if (priorRoute) require.cache[routePath] = priorRoute; else delete require.cache[routePath];
        if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
        await admin.end();
    }
});

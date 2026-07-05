'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const express = require('express');
const { createHermesStudioRouter } = require('../routes/hermes-studio');

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function jobRow(id, overrides = {}) {
    return {
        id,
        business_context: 'event_genix',
        job_type: 'creative_material_job',
        status: 'queued',
        title: `Creative job ${id}`,
        source_entity_type: 'hermes_studio',
        source_entity_id: String(id),
        source_payload: {
            title: `Creative job ${id}`,
            materialTypes: ['poster'],
            formats: ['1080x1350'],
            requirements: 'Make it clear',
            priority: 'normal',
            references: []
        },
        hermes_payload: {
            version: 1,
            jobType: 'creative_material_job',
            target: 'creative_material'
        },
        result_payload: {},
        error_message: null,
        claim_token: null,
        claimed_by: null,
        claimed_at: null,
        due_at: null,
        created_by_user_id: 11,
        created_by_snapshot: 'Studio User',
        updated_by_user_id: 11,
        updated_by_snapshot: 'Studio User',
        completed_at: null,
        created_at: '2026-07-05T09:00:00.000Z',
        updated_at: '2026-07-05T09:00:00.000Z',
        ...overrides
    };
}

function createFakePool(options = {}) {
    const calls = [];
    const hermesJobs = new Map(
        (options.jobs || []).map(row => [Number(row.id), { ...clone(row), id: Number(row.id) }])
    );
    const hermesJobAssets = (options.assets || []).map((asset, index) => ({
        id: 7000 + index,
        job_id: Number(asset.job_id),
        asset_type: asset.asset_type || 'result',
        role: asset.role || null,
        external_asset_id: asset.external_asset_id || null,
        url: asset.url || null,
        storage_key: asset.storage_key || null,
        mime_type: asset.mime_type || null,
        checksum_sha256: asset.checksum_sha256 || null,
        metadata: asset.metadata || {},
        created_at: '2026-07-05T09:15:00.000Z',
        updated_at: '2026-07-05T09:15:00.000Z'
    }));
    const hermesJobEvents = [];
    const hermesJobDecisions = [];
    let nextJobId = 61000;
    let nextEventId = 81000;
    let nextDecisionId = 91000;

    async function query(text, params = []) {
        const compact = text.replace(/\s+/g, ' ').trim();
        calls.push({ text, params, compact });

        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(compact)) {
            return { rows: [], rowCount: 0 };
        }

        if (compact.startsWith('INSERT INTO hermes_jobs')) {
            const row = {
                id: nextJobId++,
                business_context: params[0],
                job_type: params[1],
                status: 'queued',
                title: params[2],
                source_entity_type: params[3],
                source_entity_id: params[4],
                source_payload: JSON.parse(params[5] || '{}'),
                hermes_payload: JSON.parse(params[6] || '{}'),
                result_payload: {},
                error_message: null,
                claim_token: null,
                claimed_by: null,
                claimed_at: null,
                due_at: params[7] || null,
                created_by_user_id: params[8] || null,
                created_by_snapshot: params[9] || null,
                updated_by_user_id: params[8] || null,
                updated_by_snapshot: params[9] || null,
                completed_at: null,
                created_at: '2026-07-05T10:00:00.000Z',
                updated_at: '2026-07-05T10:00:00.000Z'
            };
            hermesJobs.set(row.id, row);
            return { rows: [clone(row)], rowCount: 1 };
        }

        if (compact.startsWith('SELECT * FROM hermes_jobs WHERE COALESCE')) {
            const context = String(params[0] || 'event_genix');
            const hasJobType = compact.includes('job_type =');
            const hasStatus = compact.includes('status =');
            const jobType = hasJobType ? String(params[1] || '') : null;
            const statusParamIndex = hasJobType ? 2 : 1;
            const status = hasStatus ? String(params[statusParamIndex] || '') : null;
            const limit = Number(params.at(-1) || 50);
            const rows = Array.from(hermesJobs.values())
                .filter(row => String(row.business_context || 'event_genix') === context)
                .filter(row => !jobType || row.job_type === jobType)
                .filter(row => !status || row.status === status)
                .sort((a, b) => Number(b.id) - Number(a.id))
                .slice(0, limit);
            return { rows: clone(rows), rowCount: rows.length };
        }

        if (compact.startsWith('SELECT * FROM hermes_jobs WHERE id = $1')) {
            const row = hermesJobs.get(Number(params[0]));
            const context = String(params[1] || 'event_genix');
            if (!row || String(row.business_context || 'event_genix') !== context) {
                return { rows: [], rowCount: 0 };
            }
            return { rows: [clone(row)], rowCount: 1 };
        }

        if (compact.startsWith('SELECT * FROM hermes_job_assets WHERE job_id = $1')) {
            const rows = hermesJobAssets
                .filter(row => Number(row.job_id) === Number(params[0]))
                .sort((a, b) => Number(a.id) - Number(b.id));
            return { rows: clone(rows), rowCount: rows.length };
        }

        if (compact.startsWith('SELECT * FROM hermes_job_events WHERE job_id = $1')) {
            const rows = hermesJobEvents
                .filter(row => Number(row.job_id) === Number(params[0]))
                .sort((a, b) => Number(a.id) - Number(b.id));
            return { rows: clone(rows), rowCount: rows.length };
        }

        if (compact.startsWith('SELECT * FROM hermes_job_decisions WHERE job_id = $1')) {
            const rows = hermesJobDecisions
                .filter(row => Number(row.job_id) === Number(params[0]))
                .sort((a, b) => Number(b.id) - Number(a.id));
            return { rows: clone(rows), rowCount: rows.length };
        }

        if (compact.startsWith('UPDATE hermes_jobs SET status = $3::varchar, completed_at =')) {
            const row = hermesJobs.get(Number(params[0]));
            if (!row || String(row.business_context || 'event_genix') !== String(params[1] || 'event_genix')) {
                return { rows: [], rowCount: 0 };
            }
            Object.assign(row, {
                status: params[2],
                completed_at: ['approved', 'rejected'].includes(params[2]) ? '2026-07-05T10:20:00.000Z' : row.completed_at,
                updated_by_user_id: params[3] || null,
                updated_by_snapshot: params[4] || null,
                updated_at: '2026-07-05T10:20:00.000Z'
            });
            return { rows: [clone(row)], rowCount: 1 };
        }

        if (compact.startsWith('INSERT INTO hermes_job_decisions')) {
            const row = {
                id: nextDecisionId++,
                job_id: Number(params[0]),
                decision: params[1],
                decided_by_user_id: params[2],
                decided_by_snapshot: params[3],
                notes: params[4],
                external_decision_id: params[5],
                decision_payload: JSON.parse(params[6] || '{}'),
                created_at: '2026-07-05T10:21:00.000Z'
            };
            hermesJobDecisions.push(row);
            return { rows: [clone(row)], rowCount: 1 };
        }

        if (compact.startsWith('INSERT INTO hermes_job_events')) {
            const row = {
                id: nextEventId++,
                job_id: Number(params[0]),
                event_type: params[1],
                source: params[2],
                status_from: params[3],
                status_to: params[4],
                actor_user_id: params[5],
                actor_snapshot: params[6],
                external_event_id: params[7],
                summary: params[8],
                payload: JSON.parse(params[9] || '{}'),
                created_at: '2026-07-05T10:01:00.000Z'
            };
            hermesJobEvents.push(row);
            return { rows: [clone(row)], rowCount: 1 };
        }

        throw new Error(`Unexpected Hermes Studio fake query: ${compact}`);
    }

    return {
        calls,
        hermesJobs,
        hermesJobAssets,
        hermesJobEvents,
        hermesJobDecisions,
        query,
        async connect() {
            return {
                query,
                release() {}
            };
        }
    };
}

function studioAuth(req, res, next) {
    const role = req.get('x-test-role') || 'manager';
    req.user = {
        id: 11,
        username: `${role}.user`,
        name: `${role} User`,
        role,
        business_contexts: ['event_genix'],
        default_business_context: 'event_genix'
    };
    next();
}

async function listen(app) {
    return new Promise(resolve => {
        const server = app.listen(0, () => {
            const address = server.address();
            resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
        });
    });
}

async function close(server) {
    return new Promise((resolve, reject) => server.close(err => (err ? reject(err) : resolve())));
}

async function request(baseUrl, method, path, body, headers = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
            ...(body ? { 'Content-Type': 'application/json' } : {}),
            ...headers
        },
        body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let data = {};
    try {
        data = text ? JSON.parse(text) : {};
    } catch {
        data = { raw: text };
    }
    return { status: res.status, data, text };
}

async function withStudioServer(fakePool, fn) {
    const app = express();
    app.use(express.json());
    app.use('/api/hermes-studio', createHermesStudioRouter({
        authMiddleware: studioAuth,
        pool: fakePool
    }));
    const { server, baseUrl } = await listen(app);
    try {
        await fn({ baseUrl, fakePool });
    } finally {
        await close(server);
    }
}

test('Hermes Studio lets managers create creative jobs and keeps menu-photo jobs out of the queue', async () => {
    const menuJob = jobRow(501, {
        job_type: 'menu_photo_job',
        title: 'Menu photo',
        source_payload: { product: { id: 'dish-1', name: 'Dish' } }
    });
    const creativeJob = jobRow(502, {
        title: 'Birthday poster',
        source_payload: {
            title: 'Birthday poster',
            materialTypes: ['poster'],
            formats: ['A3'],
            requirements: 'Bright and readable'
        }
    });
    const fakePool = createFakePool({
        jobs: [menuJob, creativeJob],
        assets: [
            { job_id: 502, asset_type: 'result', role: 'variant-1', url: 'https://cdn.example.com/poster.png', mime_type: 'image/png' }
        ]
    });

    await withStudioServer(fakePool, async ({ baseUrl }) => {
        const list = await request(baseUrl, 'GET', '/api/hermes-studio/jobs');
        assert.equal(list.status, 200, list.text);
        assert.equal(list.data.items.length, 1);
        assert.equal(list.data.items[0].jobType, 'creative_material_job');
        assert.equal(list.data.items[0].assets.length, 1);

        const hiddenMenu = await request(baseUrl, 'GET', '/api/hermes-studio/jobs/501');
        assert.equal(hiddenMenu.status, 404, hiddenMenu.text);

        const created = await request(baseUrl, 'POST', '/api/hermes-studio/jobs', {
            materialType: 'story',
            title: 'Weekend promo',
            source: 'Afisha draft',
            formatSize: '9:16',
            requirements: 'Keep title readable',
            deadline: '2026-07-06T12:00',
            priority: 'high',
            references: 'https://example.com/ref-1\nhttps://example.com/ref-2',
            comment: 'Use park colors'
        });
        assert.equal(created.status, 201, created.text);
        assert.equal(created.data.job.jobType, 'creative_material_job');
        assert.equal(created.data.job.sourcePayload.title, 'Weekend promo');
        assert.deepEqual(created.data.job.sourcePayload.references, [
            'https://example.com/ref-1',
            'https://example.com/ref-2'
        ]);
        assert.equal(fakePool.hermesJobs.size, 3);
    });
});

test('Hermes Studio records creative/admin human decisions in job history', async () => {
    const fakePool = createFakePool({
        jobs: [jobRow(601, {
            status: 'ready_for_review',
            updated_at: '2026-07-05T10:10:00.000Z'
        })]
    });

    await withStudioServer(fakePool, async ({ baseUrl }) => {
        const managerDenied = await request(baseUrl, 'POST', '/api/hermes-studio/jobs/601/decision', {
            decision: 'approved',
            notes: 'Looks good'
        }, { 'x-test-role': 'manager' });
        assert.equal(managerDenied.status, 403, managerDenied.text);

        const approved = await request(baseUrl, 'POST', '/api/hermes-studio/jobs/601/decision', {
            decision: 'approved',
            notes: 'Approved by creative',
            action: 'approve'
        }, { 'x-test-role': 'marketer' });
        assert.equal(approved.status, 200, approved.text);
        assert.equal(approved.data.job.status, 'approved');
        assert.equal(approved.data.job.decision.decision, 'approved');
        assert.equal(approved.data.job.history.some(event => event.eventType === 'decision_recorded'), true);
        const decisionUpdate = fakePool.calls.find(call => call.compact?.startsWith('UPDATE hermes_jobs SET status = $3::varchar, completed_at ='));
        assert.ok(decisionUpdate, 'Hermes Studio decision update must use explicit parameter casts');
        assert.match(decisionUpdate.compact, /status = \$3::varchar/);
        assert.match(decisionUpdate.compact, /CASE WHEN \$3::text IN \('approved','rejected'\)/);
        assert.equal(fakePool.hermesJobDecisions.length, 1);
        assert.equal(fakePool.hermesJobs.get(601).status, 'approved');
    });
});

test('Hermes Studio regenerate records revision history and creates a new queued creative job', async () => {
    const fakePool = createFakePool({
        jobs: [jobRow(701, {
            status: 'ready_for_review',
            title: 'Banner draft',
            source_payload: {
                title: 'Banner draft',
                materialTypes: ['banner'],
                formats: ['1920x1080'],
                requirements: 'Original request',
                priority: 'normal'
            }
        })]
    });

    await withStudioServer(fakePool, async ({ baseUrl }) => {
        const regenerated = await request(baseUrl, 'POST', '/api/hermes-studio/jobs/701/regenerate', {
            notes: 'Make the CTA larger'
        }, { 'x-test-role': 'art_director' });

        assert.equal(regenerated.status, 201, regenerated.text);
        assert.equal(regenerated.data.job.status, 'revision_requested');
        assert.equal(regenerated.data.regeneratedJob.jobType, 'creative_material_job');
        assert.equal(regenerated.data.regeneratedJob.status, 'queued');
        assert.match(regenerated.data.regeneratedJob.title, /regenerate/);
        assert.equal(fakePool.hermesJobs.size, 2);
        assert.equal(fakePool.hermesJobEvents.filter(event => event.event_type === 'decision_recorded').length, 1);
        assert.equal(fakePool.hermesJobEvents.filter(event => event.event_type === 'job_created').length, 1);
    });
});

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCreativeExecutor } = require('../services/crmCreativeExecution');
const { createScheduleOcr, validateScheduleImage, reviewedOcrRows, recognizeSchedule } = require('../services/crmScheduleOcr');
const { createNotificationDelivery } = require('../services/crmNotificationDelivery');
const { withProviderExecution } = require('../services/crmProviderExecution');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
const file = { buffer: png, mimetype: 'image/png' };
const actor = { id: 11, username: 'synthetic-manager' };
const base = { businessContext: 'event_genix', actor, confirmed: true };

function poolFixture({ busy = false, query: custom } = {}) {
    const calls = [];
    const client = {
        async query(sql, params) {
            calls.push([sql, params]);
            if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: !busy }] };
            if (custom) { const result = await custom(sql, params); if (result) return result; }
            if (sql.startsWith('SELECT business_context')) return { rows: [{ business_context: 'event_genix' }] };
            return { rows: [], rowCount: 1 };
        },
        release() { calls.push(['release']); }
    };
    return { calls, client, async connect() { calls.push(['connect']); return client; } };
}

function creativeFixture(overrides = {}) {
    const pool = poolFixture();
    let generated = 0;
    const job = { id: '1', businessContext: 'event_genix', jobType: 'creative_material_job',
        status: 'queued', title: 'Synthetic poster', sourcePayload: { requirements: 'Blue circle', references: [] } };
    const jobs = {
        async getHermesJobDetail() { return { ...job }; },
        async claimHermesJob() { assert.equal(job.status, 'queued'); job.status = 'claimed'; },
        async updateHermesJobStatus(_db, _id, body) { job.status = body.status; },
        async recordHermesJobResult(_db, _id, body) {
            assert.equal(body.status, 'ready_for_review');
            assert.equal(body.assets[0].imageBase64, png.toString('base64'));
            job.status = body.status;
        }
    };
    const run = createCreativeExecutor({ pool, jobs,
        env: { CRM_CREATIVE_EXECUTION_ENABLED: 'true' },
        async generate(input) { generated++; assert.match(input.prompt, /Blue circle/);
            return { sourceUrl: `data:image/png;base64,${png.toString('base64')}`, provider: 'fake', model: 'fake' }; },
        ...overrides });
    return { run, pool, job, generated: () => generated };
}

test('paid execution is disabled before DB/provider access by default', async () => {
    await assert.rejects(createCreativeExecutor({ env: {} })({ ...base, jobId: 1 }), { code: 'CRM_EXECUTION_DISABLED' });
    await assert.rejects(createScheduleOcr({ env: {} }).preview({ ...base, file }), { code: 'CRM_EXECUTION_DISABLED' });
    await assert.rejects(createNotificationDelivery({ env: {} })({}), { code: 'CRM_EXECUTION_DISABLED' });
});

test('creative generation claims once, stores review draft, and replays without charging', async () => {
    const f = creativeFixture();
    const first = await f.run({ ...base, jobId: 1 });
    const replay = await f.run({ ...base, jobId: 1 });
    assert.equal(first.job.status, 'ready_for_review');
    assert.equal(replay.replayed, true);
    assert.equal(f.generated(), 1);
    assert.ok(f.pool.calls.some(([sql]) => sql === 'COMMIT'));
    assert.equal(f.pool.calls.at(-1)[0], 'release');
});

test('ambiguous provider failure does not requeue creative work', async () => {
    let calls = 0;
    const f = creativeFixture({ generate: async () => { calls++; throw new Error('PRIVATE_PROVIDER_DETAIL'); } });
    await assert.rejects(f.run({ ...base, jobId: 1 }), { code: 'CRM_PROVIDER_OUTCOME_REQUIRES_REVIEW' });
    await assert.rejects(f.run({ ...base, jobId: 1 }), { code: 'CRM_CREATIVE_JOB_REQUIRES_REVIEW' });
    assert.equal(calls, 1);
});

test('post-generation persistence failure keeps durable claim and blocks second charge', async () => {
    const f = creativeFixture();
    const jobs = {
        getHermesJobDetail: async () => f.job,
        claimHermesJob: async () => { f.job.status = 'claimed'; },
        recordHermesJobResult: async () => { throw new Error('db unavailable'); }
    };
    let charges = 0;
    const run = createCreativeExecutor({ env: { CRM_CREATIVE_EXECUTION_ENABLED: 'true' }, pool: f.pool, jobs,
        generate: async () => { charges++; return { sourceUrl: `data:image/png;base64,${png.toString('base64')}` }; } });
    await assert.rejects(run({ ...base, jobId: 1 }), { code: 'CRM_CREATIVE_RESULT_PERSISTENCE_REQUIRES_REVIEW' });
    await assert.rejects(run({ ...base, jobId: 1 }), { code: 'CRM_CREATIVE_JOB_REQUIRES_REVIEW' });
    assert.equal(charges, 1);
});

test('concurrency contention rejects immediately without starting provider', async () => {
    const pool = poolFixture({ busy: true });
    await assert.rejects(withProviderExecution(pool, () => assert.fail('must not run')), { code: 'CRM_PROVIDER_BUSY' });
    assert.equal(pool.calls.at(-1)[0], 'release');
});

test('full paid budget blocks a new creative but still returns an existing review draft', async () => {
    const pool = poolFixture({ query(sql) {
        if (sql.includes('to_regclass')) return { rows: [{ name: 'menu_image_paid_operations' }] };
        if (sql.includes('count(*)')) return { rows: [{ count: 2 }] };
    } });
    const job = { businessContext: 'event_genix', jobType: 'creative_material_job', status: 'ready_for_review' };
    let claims = 0, calls = 0;
    const jobs = { getHermesJobDetail: async () => job, claimHermesJob: async () => { claims++; } };
    const run = createCreativeExecutor({ env: { CRM_CREATIVE_EXECUTION_ENABLED: 'true' }, pool, jobs,
        generate: async () => { calls++; } });
    const replay = await run({ ...base, jobId: 1 });
    assert.equal(replay.replayed, true);
    job.status = 'queued';
    await assert.rejects(run({ ...base, jobId: 1 }), { code: 'CRM_PROVIDER_BUSY' });
    assert.equal(claims, 0);
    assert.equal(calls, 0);
});

test('full paid budget rolls back a new OCR reservation before provider execution', async () => {
    const pool = poolFixture({ query(sql) {
        if (sql.includes('to_regclass')) return { rows: [{ name: 'menu_image_paid_operations' }] };
        if (sql.includes('count(*)')) return { rows: [{ count: 2 }] };
    } });
    const schedule = {
        normalizeHermesSchedulePreviewPayload: value => value,
        createHermesScheduleImport: async () => ({ created: true, import: { public_id: 'fixture', status: 'draft' } })
    };
    let calls = 0;
    const service = createScheduleOcr({ env: { CRM_SCHEDULE_OCR_ENABLED: 'true' }, pool, schedule,
        recognize: async () => { calls++; return []; } });
    await assert.rejects(service.preview({ ...base, file, documentDate: '2026-11-01' }), { code: 'CRM_PROVIDER_BUSY' });
    assert.ok(pool.calls.some(([sql]) => sql === 'ROLLBACK'));
    assert.equal(calls, 0);
});

test('creative confirmation and unsupported references are checked before claim', async () => {
    const f = creativeFixture();
    await assert.rejects(f.run({ ...base, jobId: 1, confirmed: false }), { code: 'CRM_EXECUTION_CONFIRMATION_REQUIRED' });
    f.job.sourcePayload.referenceUrls = ['https://example.invalid/reference'];
    await assert.rejects(f.run({ ...base, jobId: 1 }), { code: 'CRM_CREATIVE_REFERENCES_REQUIRE_REVIEW' });
    assert.equal(f.generated(), 0);
    assert.equal(f.job.status, 'queued');
});

test('OCR validates bytes/MIME/size and keeps low-confidence data unwriteable', () => {
    assert.equal(validateScheduleImage(file).mimeType, 'image/png');
    assert.throws(() => validateScheduleImage({ ...file, mimetype: 'image/jpeg' }), { code: 'CRM_OCR_IMAGE_TYPE_INVALID' });
    assert.throws(() => validateScheduleImage({ buffer: Buffer.alloc(4 * 1024 * 1024 + 1) }), { code: 'CRM_OCR_IMAGE_SIZE_INVALID' });
    const [row] = reviewedOcrRows([{ employeeName: 'Synthetic', date: '2026-11-01', status: 'working', confidence: 0.2 }]);
    assert.equal(row.status, null);
    assert.ok(row.issues.length);
});

function ocrFixture({ crash = false } = {}) {
    let reservation, recognized = 0, previewed = 0;
    const rows = [{ employeeName: 'Synthetic', date: '2026-11-01', status: 'working',
        startTime: '09:00', endTime: '18:00', confidence: 0.99, issues: [] }];
    const pool = poolFixture({ query(sql, params) {
        if (sql.startsWith('UPDATE hermes_schedule_imports')) {
            reservation.extracted_rows = JSON.parse(params[1]); reservation.status = 'needs_review';
        }
    } });
    const schedule = {
        normalizeHermesSchedulePreviewPayload(input) { assert.match(input.documentDate, /^\d{4}-\d{2}-\d{2}$/); return input; },
        async createHermesScheduleImport() {
            if (reservation) return { created: false, import: reservation };
            reservation = { public_id: 'synthetic-reservation', status: 'draft', extracted_rows: [] };
            return { created: true, import: reservation };
        },
        async previewHermesScheduleImport(_db, payload) {
            previewed++; assert.equal(payload.rows[0].startTime, '09:00');
            return { success: true, importId: 'synthetic-preview', scheduleWrites: 0, rows: payload.rows };
        }
    };
    const service = createScheduleOcr({ env: { CRM_SCHEDULE_OCR_ENABLED: 'true' }, pool, schedule,
        recognize: async () => { recognized++; if (crash) throw new Error('unknown provider outcome'); return rows; } });
    return { service, pool, recognized: () => recognized, previewed: () => previewed };
}

test('OCR reserves before provider, reuses extracted rows and never applies during preview', async () => {
    const f = ocrFixture();
    const input = { ...base, file, documentDate: '2026-11-01' };
    assert.equal((await f.service.preview(input)).scheduleWrites, 0);
    await f.service.preview(input);
    assert.equal(f.recognized(), 1);
    assert.equal(f.previewed(), 2);
});

test('OCR unknown outcome leaves reservation blocked instead of automatically paying again', async () => {
    const f = ocrFixture({ crash: true });
    const input = { ...base, file, documentDate: '2026-11-01' };
    await assert.rejects(f.service.preview(input), { code: 'CRM_OCR_EXECUTION_REQUIRES_REVIEW' });
    await assert.rejects(f.service.preview(input), { code: 'CRM_OCR_EXECUTION_REQUIRES_REVIEW' });
    assert.equal(f.recognized(), 1);
});

test('OCR context and apply require confirmation and the original preview actor', async () => {
    const f = ocrFixture();
    await assert.rejects(f.service.preview({ ...base, file, businessContext: 'other' }), { code: 'CRM_OCR_CONTEXT_FORBIDDEN' });
    const service = createScheduleOcr({ env: { CRM_SCHEDULE_OCR_ENABLED: 'true' }, pool: f.pool,
        schedule: { getHermesScheduleImportForUpdate: async () => ({ created_by_user_id: 99 }),
            applyHermesScheduleImport: async () => assert.fail('wrong owner must not write') } });
    await assert.rejects(service.apply({ ...base, body: { previewId: 'x' } }), { code: 'CRM_OCR_PREVIEW_FORBIDDEN' });
    await assert.rejects(service.apply({ ...base, confirmed: false }), { code: 'CRM_EXECUTION_CONFIRMATION_REQUIRED' });
});

test('OCR Responses adapter sends only bounded image input and parses synthetic response', async () => {
    let calls = 0;
    const rows = await recognizeSchedule({ image: validateScheduleImage(file), documentDate: '2026-11-01',
        model: 'synthetic-model', env: { NODE_ENV: 'test', OPENAI_API_KEY: 'synthetic-key' },
        fetchImpl: async (url, options) => {
            calls++; assert.match(url, /\/responses$/);
            const body = JSON.parse(options.body);
            assert.equal(body.store, false);
            assert.equal(body.input[0].content[1].type, 'input_image');
            assert.equal(body.max_output_tokens, 6000);
            return { ok: true, json: async () => ({ output_text: '{"rows":[]}' }) };
        } });
    assert.deepEqual(rows, []); assert.equal(calls, 1);
});

function deliveryFixture(overrides = {}) {
    const pool = poolFixture();
    const event = { event_id: 'task_created:1:owner:11', task_id: 1, owner_user_id: 11,
        created_at: '2026-11-01T12:00:00Z', status: 'pending' };
    const calls = [];
    const outbox = {
        findNotificationOutboxEventByEventId: async () => event,
        claimNotificationOutboxEvent: async () => { calls.push('claim'); event.status = 'claimed'; },
        ackNotificationOutboxEvent: async () => { calls.push('ack'); event.status = 'sent'; },
        failNotificationOutboxEvent: async () => { calls.push('fail'); event.status = 'failed'; }
    };
    const deliver = createNotificationDelivery({ pool, outbox,
        env: { CRM_TASK_DELIVERY_ENABLED: 'true', CRM_TASK_DELIVERY_CUTOVER_CONFIRMED: 'true',
            CRM_TASK_DELIVERY_NOT_BEFORE: '2026-11-01T11:00:00Z', CRM_TASK_DELIVERY_APPROVED_EVENT_IDS: event.event_id },
        resolveRecipient: async () => ({ ownerUserId: 11, chatId: '100001' }),
        transport: async () => { calls.push('send'); return { accepted: true }; }, ...overrides });
    return { deliver, event, calls, pool };
}

test('delivery preserves claim/send/ack and sent replay does not send twice', async () => {
    const f = deliveryFixture();
    const input = { eventId: f.event.event_id, businessContext: 'event_genix', confirmed: true };
    await f.deliver(input); await f.deliver(input);
    assert.deepEqual(f.calls, ['claim', 'send', 'ack']);
});

test('delivery refuses group routing, old backlog and wrong business before claim', async () => {
    const f = deliveryFixture({ resolveRecipient: async () => ({ ownerUserId: 11, chatId: '-100001' }) });
    const input = { eventId: f.event.event_id, businessContext: 'event_genix', confirmed: true };
    await assert.rejects(f.deliver(input), { code: 'CRM_DELIVERY_PERSONAL_ROUTE_REQUIRED' });
    f.event.created_at = '2026-10-01T12:00:00Z';
    await assert.rejects(f.deliver(input), { code: 'CRM_DELIVERY_BACKLOG_REQUIRES_REVIEW' });
    await assert.rejects(f.deliver({ ...input, businessContext: 'other' }), { code: 'CRM_DELIVERY_BUSINESS_FORBIDDEN' });
    assert.deepEqual(f.calls, []);
});

test('ambiguous delivery is quarantined without scheduling a retry', async () => {
    const f = deliveryFixture({ transport: async () => { throw new Error('network timeout'); } });
    await assert.rejects(f.deliver({ eventId: f.event.event_id, businessContext: 'event_genix', confirmed: true }),
        { code: 'CRM_DELIVERY_OUTCOME_UNKNOWN' });
    assert.deepEqual(f.calls, ['claim']);
    assert.ok(f.pool.calls.some(([sql]) => sql.includes("status = 'dead_letter'")));
});


test('native OCR HTTP boundary enforces existing schedule permissions and bounded multipart upload', async () => {
    const express = require('express');
    const { requireAction } = require('../middleware/auth');
    const { createScheduleOcrHandlers } = require('../services/crmScheduleOcrHttp');
    const env = {};
    const calls = [];
    const handlers = createScheduleOcrHandlers({ env, schedule: {
        preview: async input => {
            calls.push(input);
            assert.deepEqual(input.file.buffer, png);
            assert.equal(input.confirmed, true);
            return { success: true, scheduleWrites: 0, importId: 'synthetic-preview' };
        },
        apply: async input => ({ response: { success: true }, dates: [] })
    }, afterApply: () => { throw new Error('realtime unavailable'); } });
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        if (req.get('x-role')) req.user = { ...actor, role: req.get('x-role') };
        next();
    });
    app.post('/preview', requireAction('hr.schedule.manage'), handlers.preview);
    app.post('/apply', requireAction('hr.schedule.manage'), handlers.apply);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const baseUrl = 'http://127.0.0.1:' + server.address().port;
    async function upload(role, bytes = png, context) {
        const form = new FormData();
        form.append('file', new Blob([bytes], { type: 'image/png' }), 'synthetic.png');
        form.append('documentDate', '2026-11-01');
        form.append('confirmed', 'true');
        if (context) form.append('businessContext', context);
        return fetch(baseUrl + '/preview', { method: 'POST', body: form, headers: role ? { 'x-role': role } : {} });
    }
    try {
        assert.equal((await upload()).status, 401);
        assert.equal((await upload('animator')).status, 403);
        assert.equal((await upload('creator')).status, 503);
        assert.equal(calls.length, 0);
        env.CRM_SCHEDULE_OCR_ENABLED = 'true';
        assert.equal((await upload('creator', png, 'other')).status, 403);
        assert.equal((await upload('creator', Buffer.alloc(4 * 1024 * 1024 + 1))).status, 413);
        const allowed = await upload('creator');
        assert.equal(allowed.status, 200);
        assert.equal((await allowed.json()).scheduleWrites, 0);
        assert.equal(calls.length, 1);
        assert.equal(calls[0].businessContext, 'event_genix');
        const applied = await fetch(baseUrl + '/apply', { method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-role': 'creator' },
            body: JSON.stringify({ confirmed: true, previewId: 'synthetic-preview', selectedRowIds: ['row-1'] }) });
        assert.equal(applied.status, 200);
        assert.equal((await applied.json()).realtimeNotification, 'unavailable');
    } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
});


test('definite delivery rejection uses canonical retry handling without ack', async () => {
    const f = deliveryFixture({ transport: async () => ({ accepted: false, definitelyNotSent: true }) });
    const result = await f.deliver({ eventId: f.event.event_id, businessContext: 'event_genix', confirmed: true });
    assert.equal(result.status, 'retry_scheduled');
    assert.deepEqual(f.calls, ['claim', 'fail']);
    assert.ok(f.pool.calls.some(([sql, params]) => sql.includes('pg_try_advisory_lock') && params[0] === 'crm_task_delivery'));
});

test('creative paid execution requires an explicit non-retired image model before claiming a job', async () => {
    const { requireCreativeImageModel } = require('../services/crmCreativeExecution');
    for (const env of [{}, { OPENAI_IMAGE_MODEL: 'gpt-image-1-mini' },
        { OPENAI_MENU_IMAGE_MODEL: 'openai/gpt-image-1.5' }, { OPENAI_IMAGE_MODEL: 'chatgpt-image-latest' }]) {
        assert.throws(() => requireCreativeImageModel(env), { code: 'CRM_CREATIVE_MODEL_NOT_READY' });
    }
    assert.equal(requireCreativeImageModel({ OPENAI_IMAGE_MODEL: 'openai/gpt-image-2.5-flare' }), 'gpt-image-2.5-flare');
    let claimed = false, status = 'queued';
    const execute = createCreativeExecutor({ env: { CRM_CREATIVE_EXECUTION_ENABLED: 'true' }, pool: poolFixture(),
        jobs: { async getHermesJobDetail() { return { businessContext:'event_genix', jobType:'creative_material_job', status }; },
            async claimHermesJob() { claimed = true; } } });
    await assert.rejects(execute({ ...base, jobId: 1 }), { code: 'CRM_CREATIVE_MODEL_NOT_READY' });
    assert.equal(claimed, false);
    status = 'ready_for_review';
    assert.equal((await execute({ ...base, jobId: 1 })).replayed, true, 'reviewed results remain available without a configured model');
});

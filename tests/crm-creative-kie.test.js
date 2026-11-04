'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCreativeExecutor } = require('../services/crmCreativeExecution');
const { KIE_CREATIVE_GENERATOR, KIE_CREATIVE_MODEL } = require('../services/crmCreativeKieExecution');
const base = { jobId: 1, businessContext: 'event_genix', actor: { id: 11 }, confirmed: true };
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';

function fixture() {
    const state = { posts: 0, polls: [], downloads: 0, outstanding: 0, failTaskSave: false, failImageSave: false,
        failSubmit: false, pollStatus: 'generating', pollUnavailable: false, downloadFails: false };
    const job = { id: '1', businessContext: 'event_genix', jobType: 'creative_material_job', status: 'queued',
        title: 'Synthetic creative', sourcePayload: { brief: 'A blue circle' }, assets: [] };
    const calls = [];
    const client = { query: async (sql) => {
        calls.push(sql);
        if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
        if (sql.includes('count(*)') && sql.includes('hermes_jobs')) return { rows: [{ count: state.outstanding }] };
        return { rows: [] };
    }, release() {} };
    const jobs = {
        getHermesJobDetail: async () => structuredClone(job),
        claimHermesJob: async (_db, _id, context) => {
            assert.equal(job.status, 'queued'); job.status = 'claimed'; job.claimedBy = context.workerId; job.claimToken = context.claimToken;
        },
        recordHermesJobResult: async (_db, _id, body) => {
            if (body.status === 'in_progress' && state.failTaskSave) throw Error('DB_DOWN');
            if (body.status === 'ready_for_review' && state.failImageSave) throw Error('DB_DOWN');
            job.status = body.status; job.resultPayload = structuredClone(body.result); job.assets = body.assets;
        },
        updateHermesJobStatus: async (_db, _id, body) => { job.status = body.status; }
    };
    const options = { env: { CRM_CREATIVE_EXECUTION_ENABLED: 'true', CRM_CREATIVE_IMAGE_GENERATOR: KIE_CREATIVE_GENERATOR },
        pool: { connect: async () => client }, jobs,
        startKie: async input => {
            state.posts++; assert.equal(input.model, KIE_CREATIVE_MODEL); assert.equal(input.size, '1024x1024');
            assert.match(input.prompt, /blue circle/); assert.equal(job.status, 'claimed');
            assert.equal(calls.at(-1), 'COMMIT', 'claim committed before chargeable POST');
            if (state.failSubmit) throw Error('NETWORK_OUTCOME_UNKNOWN');
            return { taskId: 'synthetic_task_123' };
        },
        pollKie: async taskId => { state.polls.push(taskId); assert.equal(job.resultPayload.providerTaskId, taskId);
            if (state.pollUnavailable) throw Error('PRIVATE_PROVIDER_ERROR');
            return { status: state.pollStatus, sourceUrl: 'https://tempfile.aiquickdraw.com/synthetic.png', confirmedTerminalFailure: state.pollStatus === 'failed' };
        },
        downloadKie: async () => { state.downloads++; if (state.downloadFails) throw Error('CDN_DOWN');
            return { sourceUrl: `data:image/png;base64,${png}`, size: '1254x1254' }; }
    };
    return { job, state, options, run: () => createCreativeExecutor(options)(base), calls };
}

test('KIE receipt survives a fresh executor and resumes polling, then stores a review asset once', async () => {
    const f = fixture();
    const first = await f.run();
    assert.equal(first.pending, true); assert.equal(first.job.status, 'in_progress');
    assert.equal(first.job.resultPayload.providerTaskId, 'synthetic_task_123');
    f.state.pollStatus = 'ready';
    const second = await f.run();
    assert.equal(second.job.status, 'ready_for_review'); assert.equal(second.providerCalled, false);
    assert.equal(second.job.assets[0].imageBase64, png); assert.equal(second.job.resultPayload.generatedSize, '1254x1254');
    assert.equal((await f.run()).replayed, true); assert.equal(f.state.posts, 1); assert.equal(f.state.downloads, 1);
});
test('unknown submission remains needs_input and never automatically repeats POST', async () => {
    const f = fixture(); f.state.failSubmit = true;
    await assert.rejects(f.run(), { code: 'CRM_PROVIDER_OUTCOME_REQUIRES_REVIEW' });
    assert.equal(f.job.status, 'needs_input'); assert.equal(f.job.resultPayload.outcome, 'unknown');
    await assert.rejects(f.run(), { code: 'CRM_CREATIVE_JOB_REQUIRES_REVIEW' }); assert.equal(f.state.posts, 1);
});
test('receipt persistence failure retains the prior committed claim', async () => {
    const f = fixture(); f.state.failTaskSave = true;
    await assert.rejects(f.run(), { code: 'CRM_CREATIVE_RESULT_PERSISTENCE_REQUIRES_REVIEW' });
    assert.equal(f.job.status, 'claimed');
    await assert.rejects(f.run(), { code: 'CRM_CREATIVE_JOB_REQUIRES_REVIEW' }); assert.equal(f.state.posts, 1);
});
test('image persistence failure resumes saved task without another generation', async () => {
    const f = fixture(); f.state.pollStatus = 'ready'; f.state.failImageSave = true;
    await assert.rejects(f.run(), { code: 'CRM_CREATIVE_RESULT_PERSISTENCE_REQUIRES_REVIEW' });
    assert.equal(f.job.status, 'in_progress');
    f.state.failImageSave = false; assert.equal((await f.run()).job.status, 'ready_for_review'); assert.equal(f.state.posts, 1);
});
test('poll transport error keeps a resumable task and hides provider details', async () => {
    const f = fixture(); f.state.pollUnavailable = true;
    const result = await f.run(); assert.equal(result.pending, true); assert.equal(result.statusUnavailable, true);
    assert.equal(JSON.stringify(result).includes('PRIVATE_PROVIDER_ERROR'), false);
    f.state.pollUnavailable = false; f.state.pollStatus = 'ready'; await f.run(); assert.equal(f.state.posts, 1);
});
test('drain mode blocks new submissions while retrieving an already paid result', async () => {
    const f = fixture(); await f.run();
    f.options.env.CRM_CREATIVE_IMAGE_GENERATOR = 'disabled'; f.state.pollStatus = 'ready';
    const result = await f.run(); assert.equal(result.job.status, 'ready_for_review'); assert.equal(f.state.posts, 1);
    const fresh = fixture(); fresh.options.env.CRM_CREATIVE_IMAGE_GENERATOR = 'disabled';
    await assert.rejects(fresh.run(), { code: 'CRM_CREATIVE_MODEL_NOT_READY' });
    assert.equal(fresh.state.posts, 0); assert.equal(fresh.job.status, 'queued');
});
test('CDN error does not lose receipt or repeat paid submission', async () => {
    const f = fixture(); f.state.pollStatus = 'ready'; f.state.downloadFails = true;
    await assert.rejects(f.run(), { code: 'CRM_CREATIVE_RESULT_DOWNLOAD_REQUIRES_REVIEW' });
    f.state.downloadFails = false; await f.run(); assert.equal(f.state.posts, 1);
});
test('terminal KIE failure records failure and does not regenerate', async () => {
    const f = fixture(); f.state.pollStatus = 'failed';
    await assert.rejects(f.run(), { code: 'CRM_CREATIVE_RESULT_REQUIRES_REVIEW' }); assert.equal(f.job.status, 'failed');
    await assert.rejects(f.run(), { code: 'CRM_CREATIVE_JOB_REQUIRES_REVIEW' }); assert.equal(f.state.posts, 1);
});
test('a late image cannot overwrite a concurrent Studio rejection', async () => {
    const f = fixture(); await f.run();
    f.options.pollKie = async () => { f.job.status = 'rejected'; return { status: 'ready', sourceUrl: 'https://kie.ai/image.png' }; };
    await assert.rejects(f.run(), { code: 'CRM_CREATIVE_RESULT_PERSISTENCE_REQUIRES_REVIEW' });
    assert.equal(f.job.status, 'rejected'); assert.equal(f.job.assets.length, 0); assert.equal(f.state.posts, 1);
});
test('one outstanding async creative blocks a new submission but permits saved-task reads', async () => {
    const f = fixture(); f.state.outstanding = 1;
    await assert.rejects(f.run(), { code: 'CRM_PROVIDER_BUSY' }); assert.equal(f.state.posts, 0);
    f.state.outstanding = 0; await f.run(); f.state.outstanding = 1;
    await f.run(); assert.equal(f.state.posts, 1);
});
test('foreign ownership, wrong context and invalid saved task cannot issue provider requests', async () => {
    for (const mutate of [job => { job.businessContext = 'other'; },
        job => { job.status = 'in_progress'; job.claimedBy = 'external-hermes'; },
        job => { job.status = 'in_progress'; job.claimedBy = 'crm-creative-kie'; job.resultPayload = { executor: 'crm', provider: 'kie', model: KIE_CREATIVE_MODEL, providerTaskId: '../invalid' }; }]) {
        const f = fixture(); mutate(f.job); await assert.rejects(f.run()); assert.equal(f.state.posts, 0); assert.equal(f.state.polls.length, 0);
    }
});
test('unsupported model, missing key and references fail before a durable claim', async () => {
    const f = fixture(); f.options.env.CRM_CREATIVE_IMAGE_GENERATOR = 'kie/arbitrary';
    await assert.rejects(f.run(), { code: 'CRM_CREATIVE_MODEL_NOT_READY' }); assert.equal(f.job.status, 'queued');
    f.options.env.CRM_CREATIVE_IMAGE_GENERATOR = KIE_CREATIVE_GENERATOR;
    const start = f.options.startKie; delete f.options.startKie;
    await assert.rejects(f.run(), { code: 'CRM_CREATIVE_MODEL_NOT_READY' }); assert.equal(f.job.status, 'queued');
    f.options.startKie = start; f.job.sourcePayload.referenceUrls = ['https://example.invalid/reference'];
    await assert.rejects(f.run(), { code: 'CRM_CREATIVE_REFERENCES_REQUIRE_REVIEW' }); assert.equal(f.job.status, 'queued'); assert.equal(f.state.posts, 0);
});

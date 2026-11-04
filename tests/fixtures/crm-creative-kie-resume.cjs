'use strict';
// Fresh-process recovery probe; only the already verified disposable local DB.
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const { createCreativeExecutor } = require('../../services/crmCreativeExecution');
const target = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env);
assert.equal(target.isLocal, true);
assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
const pool = new Pool({ connectionString: target.url.href, ssl: false, max: 2 });
global.fetch = async () => { throw Error('Real provider HTTP forbidden'); };
(async () => {
    const jobId = process.env.KIE_TEST_JOB_ID;
    const run = createCreativeExecutor({ pool,
        env: { CRM_CREATIVE_EXECUTION_ENABLED: 'true', CRM_CREATIVE_IMAGE_GENERATOR: 'kie/gpt-image-2-5-flare-text-to-image' },
        startKie: async () => { throw Error('Saved task must never be resubmitted'); },
        pollKie: async task => {
            assert.equal(task, `synthetic_kie_${jobId}`);
            return { status: 'ready', sourceUrl: 'https://kie.ai/synthetic.png' };
        },
        downloadKie: async () => ({ sourceUrl: `data:image/png;base64,${process.env.KIE_TEST_PNG}`, size: '1254x1254' })
    });
    const result = await run({ jobId, businessContext: 'event_genix', actor: { id: Number(process.env.KIE_TEST_ACTOR_ID) }, confirmed: true });
    assert.equal(result.job.status, 'ready_for_review'); assert.equal(result.providerCalled, false);
    console.log(JSON.stringify({ status: result.job.status, providerCalled: result.providerCalled }));
})().catch(() => { console.error('SYNTHETIC_KIE_RESUME_FAILED'); process.exitCode = 1; }).finally(() => pool.end());

'use strict';

const { randomUUID } = require('node:crypto');
const { executionError, transaction, assertPaidCapacity } = require('./crmProviderExecution');

const KIE_CREATIVE_MODEL = 'gpt-image-2-5-flare-text-to-image';
const KIE_CREATIVE_GENERATOR = `kie/${KIE_CREATIVE_MODEL}`;
const validTask = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);

// The caller holds the deployment-wide provider session lock. All paid requests
// happen after a committed claim; only task polling can be repeated on resume.
async function executeKieCreative({ client, jobs, current, jobId, businessContext, actor, env, options, buildPrompt }) {
    const native = require('./menuPhotoGeneration');
    const start = options.startKie || native.startMenuImageWithKie;
    const poll = options.pollKie || native.pollMenuImageWithKie;
    const download = options.downloadKie || native.downloadKieCreativeImage;
    const receipt = current.resultPayload || {};
    let providerCalled = false;
    let taskId, model, context;
    async function whileOwned(status, work) {
        return transaction(client, async () => {
            // Share the row lock used by canonical Studio decisions. A late
            // provider response must never resurrect a rejected/cancelled job.
            await client.query(`SELECT id FROM hermes_jobs WHERE id = $1
                AND COALESCE(business_context, 'event_genix') = $2 FOR UPDATE`, [jobId, businessContext]);
            const latest = await jobs.getHermesJobDetail(client, jobId, businessContext);
            if (latest.status !== status || latest.claimedBy !== 'crm-creative-kie'
                || !context.claimToken || latest.claimToken !== context.claimToken
                || (status === 'in_progress' && latest.resultPayload?.providerTaskId !== taskId)) {
                throw executionError('CRM_CREATIVE_JOB_STATE_CHANGED');
            }
            return work();
        });
    }
    if (current.status === 'in_progress' && current.claimedBy === 'crm-creative-kie'
        && receipt.executor === 'crm' && receipt.provider === 'kie'
        && receipt.model === KIE_CREATIVE_MODEL && validTask(receipt.providerTaskId)) {
        taskId = receipt.providerTaskId;
        model = receipt.model;
        context = { businessContext, actor, workerId: 'crm-creative-kie', claimToken: current.claimToken };
    } else {
        if (current.status !== 'queued') throw executionError('CRM_CREATIVE_JOB_REQUIRES_REVIEW');
        if (env.CRM_CREATIVE_IMAGE_GENERATOR !== KIE_CREATIVE_GENERATOR || (!options.startKie && !env.KIE_API_KEY)) {
            throw executionError('CRM_CREATIVE_MODEL_NOT_READY', 503);
        }
        await assertPaidCapacity(client);
        // Bound async KIE work after releasing the request's session lock, too.
        // An ambiguous request remains needs_input and consumes this slot.
        const outstanding = await client.query(`SELECT count(*)::integer AS count FROM hermes_jobs
            WHERE claimed_by = 'crm-creative-kie' AND (status IN ('claimed','in_progress','needs_input')
                OR (result_payload->>'provider' = 'kie' AND result_payload->>'outcome' IN ('pending','unknown')))`);
        if (Number(outstanding.rows[0]?.count) > 0) throw executionError('CRM_PROVIDER_BUSY', 429);
        const prompt = buildPrompt(current);
        model = KIE_CREATIVE_MODEL;
        context = { businessContext, actor, workerId: 'crm-creative-kie', claimToken: randomUUID() };
        await transaction(client, () => jobs.claimHermesJob(client, jobId, context));
        let started;
        try {
            // Exactly one POST. Network ambiguity must never requeue this claim.
            providerCalled = true;
            started = await start({ prompt, size: '1024x1024', model });
            if (!validTask(started?.taskId)) throw new Error('Invalid task receipt');
        } catch {
            try {
                await whileOwned('claimed', () => jobs.recordHermesJobResult(client, jobId, {
                    status: 'needs_input', summary: 'Стан генерації потребує перевірки перед новим запуском.',
                    externalEventId: `crm-creative:${jobId}:submission-unknown`,
                    result: { executor: 'crm', provider: 'kie', model, outcome: 'unknown' }, assets: []
                }, context));
            } catch { throw executionError('CRM_CREATIVE_RESULT_PERSISTENCE_REQUIRES_REVIEW', 503); }
            throw executionError('CRM_PROVIDER_OUTCOME_REQUIRES_REVIEW', 502);
        }
        taskId = started.taskId;
        try {
            await whileOwned('claimed', () => jobs.recordHermesJobResult(client, jobId, {
                status: 'in_progress', summary: 'Генерацію запущено. Очікуємо на зображення.',
                externalEventId: `crm-creative:${jobId}:provider-task`,
                result: { executor: 'crm', provider: 'kie', model, providerTaskId: taskId, outcome: 'pending' }, assets: []
            }, context));
        } catch {
            // The earlier claim remains durable even if task receipt storage fails.
            throw executionError('CRM_CREATIVE_RESULT_PERSISTENCE_REQUIRES_REVIEW', 503);
        }
    }
    let result;
    try { result = await poll(taskId); }
    catch {
        return { job: await jobs.getHermesJobDetail(client, jobId, businessContext), pending: true,
            statusUnavailable: true, providerCalled, replayed: !providerCalled };
    }
    if (result.status === 'failed') {
        if (result.confirmedTerminalFailure) {
            await whileOwned('in_progress', () => jobs.recordHermesJobResult(client, jobId, {
                status: 'failed', summary: 'Генерація не вдалася. Перед новим запуском перевірте результат.',
                externalEventId: `crm-creative:${jobId}:provider-failed`, assets: [],
                result: { executor: 'crm', provider: 'kie', model, providerTaskId: taskId, outcome: 'failed' }
            }, context));
        }
        throw executionError('CRM_CREATIVE_RESULT_REQUIRES_REVIEW', 502);
    }
    if (result.status !== 'ready') return {
        job: await jobs.getHermesJobDetail(client, jobId, businessContext), pending: true, providerCalled, replayed: !providerCalled
    };
    let image;
    try { image = await download(result.sourceUrl); }
    catch { throw executionError('CRM_CREATIVE_RESULT_DOWNLOAD_REQUIRES_REVIEW', 502); }
    const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(image.sourceUrl || '');
    if (!match) throw executionError('CRM_CREATIVE_RESULT_REQUIRES_REVIEW', 502);
    try {
        await whileOwned('in_progress', () => jobs.recordHermesJobResult(client, jobId, {
            status: 'ready_for_review', summary: 'Чернетка готова до перегляду й погодження.',
            externalEventId: `crm-creative:${jobId}`,
            result: { executor: 'crm', provider: 'kie', model, providerTaskId: taskId, outcome: 'succeeded',
                generatedSize: image.size, requiresFormatReview: true },
            assets: [{ assetType: 'preview', role: 'preview', mimeType: 'image/png',
                externalAssetId: `crm-creative:${jobId}:preview`, imageBase64: match[1] }]
        }, context));
    } catch { throw executionError('CRM_CREATIVE_RESULT_PERSISTENCE_REQUIRES_REVIEW', 503); }
    return { job: await jobs.getHermesJobDetail(client, jobId, businessContext), pending: false,
        replayed: !providerCalled, providerCalled };
}

module.exports = { executeKieCreative, KIE_CREATIVE_MODEL, KIE_CREATIVE_GENERATOR };

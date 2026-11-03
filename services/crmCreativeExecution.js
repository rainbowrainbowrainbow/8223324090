'use strict';

const { randomUUID } = require('node:crypto');
const { executionError, requireExecutionEnabled, transaction, withProviderExecution, assertPaidCapacity } = require('./crmProviderExecution');

function creativePrompt(job) {
    const payload = job.sourcePayload || job.payload || {};
    const prompt = [job.title, payload.brief, payload.requirements, payload.copy,
        payload.materialType, payload.formatSize, payload.tone, payload.audience, payload.brandRules]
        .filter(value => typeof value === 'string' && value.trim()).join('\n');
    if (!prompt.trim()) throw executionError('CRM_CREATIVE_BRIEF_REQUIRED', 400);
    if (payload.referenceAssetIds?.length || payload.referenceUrls?.length || payload.references?.length) {
        throw executionError('CRM_CREATIVE_REFERENCES_REQUIRE_REVIEW', 422);
    }
    return [prompt, ...(payload.materialTypes || []), ...(payload.formats || [])].join('\n').slice(0, 5000);
}

// Do not send a paid request with the retired legacy default. Selection is
// an explicit operator decision after quality and access validation.
function requireCreativeImageModel(env) {
    const configured = String(env.OPENAI_MENU_IMAGE_MODEL || env.OPENAI_IMAGE_MODEL || '').trim().replace(/^openai\//i, '');
    if (!configured || /^(?:gpt-image-1(?:-mini)?|gpt-image-1\.5(?:-2025-12-16)?|chatgpt-image-latest)$/i.test(configured)) {
        throw executionError('CRM_CREATIVE_MODEL_NOT_READY', 503);
    }
    return configured;
}

function createCreativeExecutor(options = {}) {
    const env = options.env || process.env;
    return async function executeCreative({ jobId, businessContext, actor, confirmed }) {
        requireExecutionEnabled(env, 'CRM_CREATIVE_EXECUTION_ENABLED');
        if (confirmed !== true) throw executionError('CRM_EXECUTION_CONFIRMATION_REQUIRED', 400);
        if (!actor?.id || !businessContext) throw executionError('CRM_EXECUTION_CONTEXT_REQUIRED', 403);
        const pool = options.pool || require('../db').pool;
        const jobs = options.jobs || require('./hermesJobs');
        const generate = options.generate || require('./menuPhotoGeneration').generateMenuImageWithOpenAI;
        return withProviderExecution(pool, async client => {
            const current = await jobs.getHermesJobDetail(client, jobId, businessContext);
            if (current.businessContext !== businessContext) throw executionError('CRM_CREATIVE_BUSINESS_FORBIDDEN', 403);
            if (current.jobType !== 'creative_material_job') throw executionError('CRM_CREATIVE_JOB_NOT_FOUND', 404);
            if (current.status === 'ready_for_review' || current.status === 'approved') {
                return { job: current, replayed: true, providerCalled: false };
            }
            if (current.status !== 'queued') throw executionError('CRM_CREATIVE_JOB_REQUIRES_REVIEW');
            await assertPaidCapacity(client);
            if (!options.generate) requireCreativeImageModel(env);
            const prompt = creativePrompt(current);
            const context = { businessContext, actor, workerId: 'crm-creative', claimToken: randomUUID() };
            await transaction(client, () => jobs.claimHermesJob(client, jobId, context));
            let generated;
            try {
                // No automatic retry: a timeout may have incurred a provider charge.
                generated = await generate({ prompt, size: '1024x1024', style: 'creative', timeoutMs: 60000 });
            } catch {
                await transaction(client, () => jobs.updateHermesJobStatus(client, jobId, {
                    status: 'failed', message: 'Provider outcome requires review before explicit regeneration',
                    payload: { code: 'CRM_PROVIDER_OUTCOME_REQUIRES_REVIEW' }
                }, context));
                throw executionError('CRM_PROVIDER_OUTCOME_REQUIRES_REVIEW', 502);
            }
            const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(generated.sourceUrl || '');
            if (!match) throw executionError('CRM_CREATIVE_RESULT_REQUIRES_REVIEW', 502);
            try {
                await transaction(client, () => jobs.recordHermesJobResult(client, jobId, {
                    status: 'ready_for_review', summary: 'CRM generation ready for human review',
                    externalEventId: `crm-creative:${jobId}`,
                    result: { provider: generated.provider, model: generated.model, executor: 'crm',
                        generatedSize: generated.size || '1024x1024', requiresFormatReview: true },
                    assets: [{ assetType: 'preview', role: 'preview', mimeType: 'image/png',
                        externalAssetId: `crm-creative:${jobId}:preview`, imageBase64: match[1] }]
                }, context));
            } catch {
                // Keep the durable claim: never make a charged request retryable
                // merely because persistence failed after generation.
                throw executionError('CRM_CREATIVE_RESULT_PERSISTENCE_REQUIRES_REVIEW', 503);
            }
            return { job: await jobs.getHermesJobDetail(client, jobId, businessContext),
                replayed: false, providerCalled: true };
        });
    };
}

module.exports = { createCreativeExecutor, creativePrompt, requireCreativeImageModel };

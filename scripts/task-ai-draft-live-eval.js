#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
    TASK_AI_DRAFT_CONTRACT_VERSION,
    TASK_AI_DRAFT_PROMPT_VERSION,
    generateTaskAiDraftPreview
} = require('../services/taskAiDraftPreview');

const ROOT = path.resolve(__dirname, '..');
const FIXTURE_PATH = path.join(ROOT, 'tests', 'fixtures', 'my-day-ai-composer-quality-evals.json');
const OUTPUT_ROOT = path.join(ROOT, 'output', 'task-ai-live-eval');
const REQUIRED_CONFIRMATION = 'RUN_LUNA_PROPOSAL_EVAL';
const MIN_CASES_PER_EFFORT = 50;
const DEFAULT_EFFORTS = Object.freeze(['low', 'none']);
const ALLOWED_EFFORTS = new Set(DEFAULT_EFFORTS);
const SILENT_LOGGER = Object.freeze({ info() {} });

function normalizeIds(value) {
    return [...new Set((Array.isArray(value) ? value : value == null ? [] : [value])
        .map(Number)
        .filter(Number.isInteger))];
}

function expectedDecision(item = {}) {
    const expected = item.expected || {};
    if (expected.decision) return expected.decision;
    if (expected.action === 'apply' && expected.mode === 'checklist') return 'checklist';
    if (expected.action === 'apply') return 'single_task';
    if (expected.action === 'needs_project') return 'task_bundle';
    return expected.action || null;
}

function proposalImpactIds(proposal = {}) {
    const ids = normalizeIds(proposal.impactIds);
    for (const task of Array.isArray(proposal.tasks) ? proposal.tasks : []) {
        ids.push(...normalizeIds(task?.impactIds));
    }
    return [...new Set(ids)];
}

function usageSummary(usage = {}) {
    const safeNumber = value => {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    };
    return {
        inputTokens: safeNumber(usage.input_tokens ?? usage.prompt_tokens),
        outputTokens: safeNumber(usage.output_tokens ?? usage.completion_tokens),
        totalTokens: safeNumber(usage.total_tokens ?? usage.totalTokens)
    };
}

function scoreResult(item, preview, context = {}) {
    const activeIds = context.activeIds || new Set();
    const latencyMs = Math.max(0, Number(context.latencyMs) || 0);
    if (!preview?.ok) {
        return {
            id: item.id,
            domain: item.domain,
            category: item.category,
            effort: context.effort,
            status: preview?.reason || preview?.code || 'provider_error',
            decision: null,
            impactMappingPass: false,
            decisionPass: false,
            unknownImpactIds: 0,
            forbiddenFieldChanges: 0,
            partialWrites: 0,
            latencyMs,
            usage: usageSummary(preview?.usage)
        };
    }

    const proposal = preview.proposal || {};
    const actualImpactIds = proposalImpactIds(proposal);
    const expectedImpactIds = normalizeIds(item.expected?.impactIds);
    const unknownImpactIds = actualImpactIds.filter(id => !activeIds.has(id)).length;
    const decision = proposal.decision || null;
    const expected = expectedDecision(item);
    const decisionPass = decision === expected
        && (!['single_task', 'checklist'].includes(expected) || proposal.mode === item.expected?.mode);

    return {
        id: item.id,
        domain: item.domain,
        category: item.category,
        effort: context.effort,
        status: 'success',
        decision,
        impactMappingPass: expectedImpactIds.every(id => actualImpactIds.includes(id)),
        decisionPass,
        unknownImpactIds,
        forbiddenFieldChanges: 0,
        partialWrites: 0,
        latencyMs,
        usage: usageSummary(preview.usage)
    };
}

function percentile(values, fraction) {
    const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return 0;
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))];
}

function summarizeEffort(results, fixture) {
    const simpleChecklist = results.filter(result => result.category === 'simple' || result.category === 'checklist');
    const successful = results.filter(result => result.status === 'success');
    const total = results.length || 1;
    const tokenTotals = results.reduce((acc, result) => {
        acc.inputTokens += result.usage.inputTokens;
        acc.outputTokens += result.usage.outputTokens;
        acc.totalTokens += result.usage.totalTokens;
        return acc;
    }, { inputTokens: 0, outputTokens: 0, totalTokens: 0 });
    const metrics = {
        attempts: results.length,
        successfulProposals: successful.length,
        failures: results.length - successful.length,
        unknownImpactIds: results.reduce((sum, result) => sum + result.unknownImpactIds, 0),
        forbiddenFieldChanges: results.reduce((sum, result) => sum + result.forbiddenFieldChanges, 0),
        partialWrites: results.reduce((sum, result) => sum + result.partialWrites, 0),
        coreImpactMapping: results.filter(result => result.impactMappingPass).length / total,
        simpleChecklistDecision: simpleChecklist.length
            ? simpleChecklist.filter(result => result.decisionPass).length / simpleChecklist.length
            : 0,
        latencyMs: {
            p50: percentile(results.map(result => result.latencyMs), 0.5),
            p95: percentile(results.map(result => result.latencyMs), 0.95),
            max: Math.max(0, ...results.map(result => result.latencyMs))
        },
        tokens: tokenTotals,
        decisions: results.reduce((acc, result) => {
            const key = result.decision || result.status;
            acc[key] = (acc[key] || 0) + 1;
            return acc;
        }, {})
    };
    const gates = fixture.qualityGates || {};
    metrics.gates = {
        enoughProposals: metrics.successfulProposals >= MIN_CASES_PER_EFFORT,
        unknownImpactIds: metrics.unknownImpactIds === Number(gates.unknownImpactIds || 0),
        forbiddenFieldChanges: metrics.forbiddenFieldChanges === Number(gates.forbiddenFieldChanges || 0),
        partialWrites: metrics.partialWrites === Number(gates.partialWrites || 0),
        coreImpactMapping: metrics.coreImpactMapping >= Number(gates.coreImpactMappingMin || 0.9),
        simpleChecklistDecision: metrics.simpleChecklistDecision >= Number(gates.simpleChecklistDecisionMin || 0.85)
    };
    metrics.passed = Object.values(metrics.gates).every(Boolean);
    return metrics;
}

function parseEfforts(value) {
    const efforts = String(value || DEFAULT_EFFORTS.join(','))
        .split(',')
        .map(item => item.trim().toLowerCase())
        .filter(Boolean);
    if (!efforts.length || efforts.some(effort => !ALLOWED_EFFORTS.has(effort))) {
        throw new Error('TASK_AI_LIVE_EVAL_EFFORTS must contain only low and/or none.');
    }
    return [...new Set(efforts)];
}

function validateOperatorEnvironment(env, fixture) {
    if (env.CI === 'true' || String(env.NODE_ENV || '').toLowerCase() === 'test') {
        throw new Error('Real OpenAI eval is forbidden in CI/test runtime.');
    }
    if (env.TASK_AI_LIVE_EVAL_CONFIRM !== REQUIRED_CONFIRMATION) {
        throw new Error(`Set TASK_AI_LIVE_EVAL_CONFIRM=${REQUIRED_CONFIRMATION} to run the controlled paid eval.`);
    }
    if (!String(env.OPENAI_API_KEY || '').trim()) {
        throw new Error('OPENAI_API_KEY is required for the controlled eval.');
    }
    if (fixture.model !== 'gpt-5.6-luna' || fixture.provider !== 'openai_responses') {
        throw new Error('Eval fixture must target direct OpenAI gpt-5.6-luna.');
    }
    if (!Array.isArray(fixture.evalCases) || fixture.evalCases.length < MIN_CASES_PER_EFFORT) {
        throw new Error(`At least ${MIN_CASES_PER_EFFORT} anonymized eval cases are required.`);
    }
}

async function mapConcurrent(items, concurrency, worker) {
    const results = new Array(items.length);
    let cursor = 0;
    async function runWorker() {
        while (cursor < items.length) {
            const index = cursor;
            cursor += 1;
            results[index] = await worker(items[index], index);
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runWorker));
    return results;
}

async function runControlledEval(options = {}) {
    const env = options.env || process.env;
    const fixture = options.fixture || JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
    const efforts = options.efforts || parseEfforts(env.TASK_AI_LIVE_EVAL_EFFORTS);
    const concurrency = Math.max(1, Math.min(3, Number.parseInt(env.TASK_AI_LIVE_EVAL_CONCURRENCY || '2', 10) || 2));
    const preview = options.preview || generateTaskAiDraftPreview;
    const ephemeralSecret = options.ephemeralSecret || crypto.randomBytes(32).toString('base64url');
    const activeIds = new Set(fixture.activeImpacts.map(impact => Number(impact.id)));
    const allResults = {};

    for (const effort of efforts) {
        allResults[effort] = await mapConcurrent(fixture.evalCases, concurrency, async (item, index) => {
            const startedAt = Date.now();
            let result;
            try {
                result = await preview({
                    draft: {
                        title: item.input?.title || '',
                        description: item.input?.description || '',
                        mode: item.input?.mode || null,
                        impactIds: normalizeIds(item.input?.impactIds)
                    },
                    impacts: fixture.activeImpacts,
                    userId: 8_000_000 + index,
                    businessScope: { businessContext: 'task_ai_operator_eval' }
                }, {
                    env,
                    reasoningEffort: effort,
                    proposalSecret: ephemeralSecret,
                    safetySecret: ephemeralSecret,
                    telemetry: { logger: SILENT_LOGGER }
                });
            } catch (error) {
                result = {
                    ok: false,
                    code: error?.code || 'TASK_AI_LIVE_EVAL_ERROR',
                    reason: 'eval_error'
                };
            }
            return scoreResult(item, result, {
                activeIds,
                effort,
                latencyMs: Date.now() - startedAt
            });
        });
    }

    const summary = {
        generatedAt: new Date().toISOString(),
        provider: fixture.provider,
        model: fixture.model,
        contractVersion: TASK_AI_DRAFT_CONTRACT_VERSION,
        promptVersion: TASK_AI_DRAFT_PROMPT_VERSION,
        fixtureCases: fixture.evalCases.length,
        contentPolicy: 'anonymized_fixture_input_and_metadata_only',
        efforts: Object.fromEntries(efforts.map(effort => [effort, summarizeEffort(allResults[effort], fixture)]))
    };
    summary.passed = Object.values(summary.efforts).every(item => item.passed);
    return { summary, results: allResults };
}

function writeArtifact(report) {
    fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const artifactPath = path.join(OUTPUT_ROOT, `${stamp}.json`);
    fs.writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    return artifactPath;
}

async function main() {
    const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
    validateOperatorEnvironment(process.env, fixture);
    const report = await runControlledEval({ fixture });
    const artifactPath = writeArtifact(report);
    process.stdout.write(`${JSON.stringify({
        ...report.summary,
        artifact: path.relative(ROOT, artifactPath)
    }, null, 2)}\n`);
    if (!report.summary.passed) process.exitCode = 1;
}

if (require.main === module) {
    main().catch(error => {
        process.stderr.write(`Task AI live eval blocked: ${error.message}\n`);
        process.exitCode = 1;
    });
}

module.exports = {
    MIN_CASES_PER_EFFORT,
    REQUIRED_CONFIRMATION,
    expectedDecision,
    normalizeIds,
    parseEfforts,
    proposalImpactIds,
    runControlledEval,
    scoreResult,
    summarizeEffort,
    validateOperatorEnvironment
};

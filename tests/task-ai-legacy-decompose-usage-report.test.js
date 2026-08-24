'use strict';

const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const legacyReport = require('../scripts/task-ai-legacy-decompose-usage-report');

const RELEASE_SHA = 'b'.repeat(40);

function reportOptions(overrides = {}) {
    return {
        version: '0.81.18',
        sha: RELEASE_SHA,
        sourceBranch: 'codex/eventgenix-production',
        deploymentId: 'deployment-v08118',
        deploymentStart: '2026-07-20T00:00:00.000Z',
        deploymentEnd: '2026-08-24T00:00:00.000Z',
        windows: legacyReport.DEFAULT_WINDOWS,
        ...overrides
    };
}

function legacyEvent(overrides = {}) {
    return {
        msg: 'task_ai_draft_event',
        ts: '2026-08-24T10:00:00.000Z',
        requestId: 'legacy-request-1',
        deploymentId: 'deployment-v08118',
        data: {
            type: 'deprecation',
            status: 'success',
            route: legacyReport.LEGACY_ROUTE,
            reasonCode: 'legacy_decompose_wrapper_used',
            clientVersion: 'external-client/1.0',
            releaseVersion: '0.81.18',
            releaseSha: RELEASE_SHA,
            deploymentId: 'deployment-v08118',
            timestampBucket: '2026-08-24T10:00:00.000Z',
            ...overrides
        }
    };
}

function httpRow(overrides = {}) {
    return {
        timestamp: '2026-08-24T10:00:00.000Z',
        deploymentId: 'deployment-v08118',
        requestId: 'legacy-http-1',
        method: 'POST',
        path: `${legacyReport.LEGACY_ROUTE}?source=old-client`,
        status: 200,
        ...overrides
    };
}

test('legacy decompose report documents non-QA consumer and excludes QA usage', () => {
    const parsed = legacyReport.parseLogText([
        JSON.stringify(legacyEvent()),
        JSON.stringify(legacyEvent({
            clientVersion: 'playwright-actual-app-smoke',
            requestId: 'qa-request-1'
        }))
    ].join('\n'));

    const built = legacyReport.buildReport(reportOptions(), [parsed, parsed, parsed]);

    assert.equal(built.verdict.status, 'hold');
    assert.equal(built.verdict.reason, legacyReport.VERDICT_REASONS.DOCUMENTED_CONSUMER);
    assert.equal(built.windows[0].usage.realUsageRequests, 1);
    assert.equal(built.windows[0].usage.qaEvents, 1);
    assert.equal(built.verdict.removalAllowedWithoutConfirmation, false);
    assert.doesNotMatch(JSON.stringify(built), /task title|provider response|proposalToken|OPENAI_API_KEY/i);
});

test('legacy decompose report detects HTTP traffic without compatibility telemetry', () => {
    const parsed = legacyReport.parseLogText(JSON.stringify(httpRow()));
    const built = legacyReport.buildReport(reportOptions(), [parsed, parsed, parsed]);

    assert.equal(built.verdict.status, 'hold');
    assert.equal(built.verdict.reason, legacyReport.VERDICT_REASONS.TELEMETRY_GAP);
    assert.equal(built.windows[0].sources.httpRequests, 1);
    assert.equal(built.windows[0].sources.legacyTelemetryEvents, 0);
});

test('legacy decompose report holds removal while the 30d window is incomplete', () => {
    const built = legacyReport.buildReport(reportOptions({
        deploymentStart: '2026-08-23T00:00:00.000Z',
        deploymentEnd: '2026-08-24T00:00:00.000Z'
    }), [{}, {}, {}]);

    assert.equal(built.verdict.status, 'hold');
    assert.equal(built.verdict.reason, legacyReport.VERDICT_REASONS.HOLD_REMOVAL);
    assert.equal(built.windows[2].completeness.complete, false);
});

test('legacy decompose report is ready only after complete 30d zero real usage window', () => {
    const built = legacyReport.buildReport(reportOptions(), [{}, {}, {}]);

    assert.equal(built.verdict.status, 'ready_for_confirmation');
    assert.equal(built.verdict.reason, legacyReport.VERDICT_REASONS.READY_FOR_REMOVAL_CONFIRMATION);
    assert.equal(built.windows[2].completeness.complete, true);
    assert.equal(built.verdict.removalAllowedWithoutConfirmation, false);
});

test('legacy decompose report rejects invalid exact release metadata', () => {
    const built = legacyReport.buildReport(reportOptions({
        sha: 'short-sha',
        deploymentId: ''
    }), [{}, {}, {}]);

    assert.equal(built.verdict.status, 'hold');
    assert.equal(built.verdict.reason, legacyReport.VERDICT_REASONS.INVALID_ARTIFACT_METADATA);
    assert.ok(built.verdict.metadataIssues.some(item => item.includes('deployment ID')));
    assert.ok(built.verdict.metadataIssues.some(item => item.includes('40-character')));
});

test('legacy decompose parser fails closed on unknown non-empty input', () => {
    const parsed = legacyReport.parseLogText('{"message":"unrelated production log"}');

    assert.equal(parsed.nonEmptyLines, 1);
    assert.equal(parsed.recognizedLines, 0);
    assert.throws(
        () => legacyReport.assertRecognizedInput(parsed, 'Legacy usage input'),
        /no recognized Task AI legacy telemetry/
    );
});

test('legacy decompose collector reads Railway telemetry and HTTP logs without raw artifact storage', async () => {
    const calls = [];
    const runner = (executable, args) => {
        calls.push({ executable, args });
        const isTelemetryCall = args.includes('--filter');
        const stdout = isTelemetryCall ? '' : `${JSON.stringify(httpRow({ requestId: 'legacy-http-1' }))}\n`;
        return { status: 0, stdout, stderr: '' };
    };

    const result = await legacyReport.run({
        ...reportOptions({
            service: '8223324090',
            outputPrefix: path.join(os.tmpdir(), 'eventgenix-legacy-decompose-test-artifact'),
            windows: [{ label: '24h', since: '24h', hours: 24 }]
        })
    }, { runner });

    assert.equal(result.report.verdict.reason, legacyReport.VERDICT_REASONS.TELEMETRY_GAP);
    assert.ok(calls.some(call => call.args.includes('--filter') && call.args.includes('task_ai_draft_event')));
    assert.ok(calls.some(call => call.args.includes('--http') && call.args.includes('--path') && call.args.includes(legacyReport.LEGACY_ROUTE)));
    assert.doesNotMatch(JSON.stringify(result.report), /provider response|proposalToken|OPENAI_API_KEY/i);
});

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const report = require('../scripts/task-ai-rollout-report');
const collector = require('../scripts/collect-task-ai-rollout-logs');

function previewEvent(offsetHours, overrides = {}) {
    const observedAt = new Date(Date.UTC(2026, 7, 10, offsetHours, 0, 0)).toISOString();
    return {
        observedAt,
        source: 'logs',
        event: {
            type: 'preview',
            status: 'success',
            latencyMs: 100 + offsetHours,
            model: 'gpt-5.6-luna',
            provider: 'openai',
            releaseVersion: '0.81.11',
            releaseSha: '1d563ec90ec8b154d770bdf7e77724f47e702750',
            deploymentId: 'deployment-current',
            rolloutStage: '20',
            expectedRolloutPercent: '20',
            contractVersion: 'my_day_ai_composer_proposal_v2',
            promptVersion: '2026-08-09.4',
            reasoningEffort: 'low',
            correlationId: `preview-${offsetHours}`,
            reasonCode: 'checklist',
            changedFields: ['title', 'impactIds', 'subtasks'],
            usage: { input_tokens: 50, output_tokens: 60, total_tokens: 110 },
            ...overrides
        }
    };
}

test('task AI rollout report parses sanitized structured and pretty telemetry without task text', () => {
    const text = [
        JSON.stringify({
            ts: '2026-08-10T00:00:00.000Z',
            module: 'TaskAiDraftTelemetry',
            msg: 'task_ai_draft_event',
            data: {
                type: 'preview',
                status: 'success',
                latencyMs: 120,
                model: 'gpt-5.6-luna',
                changedFields: ['title'],
                fallbackReason: 'minimal_content',
                usage: { total_tokens: 90 },
                promptText: 'must be ignored because sanitizer rejects unknown sensitive fields only before logging'
            }
        }).replace(',"promptText":"must be ignored because sanitizer rejects unknown sensitive fields only before logging"', ''),
        '10:00:00.000 INFO  [TaskAiDraftTelemetry] task_ai_draft_event {"type":"commit","status":"success","acceptedFieldMask":["title","scheduleDate"],"taskCount":1}'
    ].join('\n');

    const events = report.parseTelemetryLogText(text);
    assert.equal(events.length, 2);
    assert.equal(events[0].event.type, 'preview');
    assert.equal(events[1].event.type, 'commit');
    assert.deepEqual(events[1].event.acceptedFieldMask, ['title', 'scheduleDate']);

    const built = report.buildReport({
        logEvents: events,
        dbEvidence: { available: false, events: [], checks: null },
        options: { hours: 24, minProposals: 30, providerErrorRateMax: 0.05 }
    });
    const serialized = JSON.stringify(built);
    assert.doesNotMatch(serialized, /OPENAI_API_KEY|proposalToken|provider response|Sensitive CRM|promptText/i);
    assert.equal(built.telemetry.successfulProposals, 0);
    assert.equal(built.telemetry.fallbackProposalCount, 1);
    assert.equal(built.telemetry.byFallbackReason.minimal_content, 1);
    assert.equal(built.telemetry.byOutcome.fallback_proposal, 1);
    assert.equal(built.verdict.status, 'hold');
    assert.ok(built.verdict.missingEvidence.includes('read-only database evidence from TASK_AI_ROLLOUT_DATABASE_URL'));
});

test('task AI rollout report accepts stdin, release metadata and stage options', () => {
    const options = report.parseArgs([
        '--stdin',
        '--stage', '50',
        '--version', '0.80.128',
        '--sha', '318da0a178b7e4c8a1a89862c2797174223f6944',
        '--expected-rollout-percent', '50',
        '--format', 'markdown'
    ]);

    assert.equal(options.stdin, true);
    assert.equal(options.stage, '50');
    assert.equal(options.version, '0.80.128');
    assert.equal(options.expectedRolloutPercent, '50');
});

test('task AI rollout report supports exact prompt, contract and deployment filters', () => {
    const options = report.parseArgs([
        '--stage', '20',
        '--version', '0.81.11',
        '--sha', '1d563ec90ec8b154d770bdf7e77724f47e702750',
        '--prompt-version', '2026-08-09.4',
        '--contract-version', 'my_day_ai_composer_proposal_v2',
        '--deployment-id', 'deployment-current',
        '--expected-rollout-percent', '20'
    ]);

    assert.equal(options.promptVersion, '2026-08-09.4');
    assert.equal(options.contractVersion, 'my_day_ai_composer_proposal_v2');
    assert.equal(options.deploymentId, 'deployment-current');
});

test('task AI rollout verdict passes with 30 successful proposals and clean database evidence', () => {
    const logEvents = Array.from({ length: 30 }, (_, index) => previewEvent(index));
    const dbEvidence = {
        available: true,
        events: [{
            observedAt: '2026-08-10T12:00:00.000Z',
            source: 'database',
            event: { type: 'commit', status: 'success', taskCount: 1, acceptedFieldMask: ['title'] }
        }],
        checks: {
            duplicateCommits: 0,
            partialImpactWrites: 0,
            partialSubtaskWrites: 0,
            partialBundleWrites: 0,
            schedulePlacementFailures: 0
        }
    };

    const built = report.buildReport({
        logEvents,
        dbEvidence,
        options: { hours: 24, minProposals: 30, providerErrorRateMax: 0.05 }
    });

    assert.equal(built.verdict.status, 'pass');
    assert.equal(built.telemetry.successfulProposals, 30);
    assert.equal(built.verdict.gates.enoughSuccessfulProposals, true);
    assert.equal(built.verdict.gates.enoughVolumeOrTimeEvidence, true);
    assert.equal(built.verdict.gates.partialWrites, true);
    assert.equal(built.verdict.gates.duplicateCommits, true);
    assert.equal(built.verdict.missingEvidence.length, 0);
});

test('task AI rollout exact filters exclude older release events', () => {
    const current = previewEvent(0, { correlationId: 'current' });
    const old = previewEvent(1, {
        releaseVersion: '0.81.10',
        releaseSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        deploymentId: 'old',
        correlationId: 'old'
    });

    const built = report.buildReport({
        logEvents: [current, old],
        dbEvidence: {
            available: true,
            events: [],
            checks: {
                duplicateCommits: 0,
                partialImpactWrites: 0,
                partialSubtaskWrites: 0,
                partialBundleWrites: 0,
                schedulePlacementFailures: 0
            }
        },
        options: {
            hours: 24,
            minProposals: 1,
            providerErrorRateMax: 0.05,
            version: '0.81.11',
            sha: '1d563ec90ec8b154d770bdf7e77724f47e702750',
            promptVersion: '2026-08-09.4',
            contractVersion: 'my_day_ai_composer_proposal_v2',
            deploymentId: 'deployment-current'
        }
    });

    assert.equal(built.sources.exactFilteredEvents, 1);
    assert.equal(built.telemetry.successfulProposals, 1);
    assert.equal(built.verdict.status, 'pass');
});

test('task AI rollout deduplicates matching DB and log correlation IDs', () => {
    const logEvent = previewEvent(0, { correlationId: 'shared-preview' });
    const commitLog = {
        observedAt: '2026-08-10T01:00:00.000Z',
        source: 'logs',
        event: { type: 'commit', status: 'success', latencyMs: 250, correlationId: 'same-commit', acceptedFieldMask: ['title'] }
    };
    const commitDb = {
        observedAt: '2026-08-10T01:00:00.000Z',
        source: 'database',
        event: { type: 'commit', status: 'success', latencyMs: 0, correlationId: 'same-commit', acceptedFieldMask: ['title'] }
    };

    const built = report.buildReport({
        logEvents: [logEvent, commitLog],
        dbEvidence: {
            available: true,
            events: [commitDb],
            checks: {
                duplicateCommits: 0,
                partialImpactWrites: 0,
                partialSubtaskWrites: 0,
                partialBundleWrites: 0,
                schedulePlacementFailures: 0
            }
        },
        options: { hours: 24, minProposals: 1, providerErrorRateMax: 0.05 }
    });

    assert.equal(built.sources.exactFilteredEvents, 3);
    assert.equal(built.sources.deduplicatedEvents, 2);
    assert.equal(built.telemetry.latencyMs.commit.p50, 250);
});

test('task AI rollout verdict also passes with 24h timestamp window and fewer successful proposals', () => {
    const logEvents = [previewEvent(0), previewEvent(24)];
    const dbEvidence = {
        available: true,
        events: [{
            observedAt: '2026-08-11T00:00:00.000Z',
            source: 'database',
            event: { type: 'commit', status: 'success', taskCount: 1, acceptedFieldMask: ['title'] }
        }],
        checks: {
            duplicateCommits: 0,
            partialImpactWrites: 0,
            partialSubtaskWrites: 0,
            partialBundleWrites: 0,
            schedulePlacementFailures: 0
        }
    };

    const built = report.buildReport({
        logEvents,
        dbEvidence,
        options: { hours: 24, minProposals: 30, providerErrorRateMax: 0.05, version: '0.81.11', sha: '1d563ec90ec8b154d770bdf7e77724f47e702750', stage: '20', expectedRolloutPercent: '20' }
    });

    assert.equal(built.verdict.status, 'pass');
    assert.equal(built.verdict.gates.enoughSuccessfulProposals, false);
    assert.equal(built.verdict.gates.enoughTimeEvidence, true);
    assert.equal(built.verdict.gates.enoughVolumeOrTimeEvidence, true);
    assert.equal(built.release.version, '0.81.11');
    assert.equal(built.release.stage, '20');
});

test('task AI rollout verdict holds when neither proposal volume nor time window is enough', () => {
    const built = report.buildReport({
        logEvents: [previewEvent(0), previewEvent(1)],
        dbEvidence: {
            available: true,
            events: [],
            checks: {
                duplicateCommits: 0,
                partialImpactWrites: 0,
                partialSubtaskWrites: 0,
                partialBundleWrites: 0,
                schedulePlacementFailures: 0
            }
        },
        options: { hours: 24, minProposals: 30, providerErrorRateMax: 0.05 }
    });

    assert.equal(built.verdict.status, 'hold');
    assert.equal(built.verdict.gates.enoughVolumeOrTimeEvidence, false);
    assert.ok(built.verdict.missingEvidence.some(item => /successful proposals or 24h/.test(item)));
});

test('task AI rollout verdict holds on provider errors, unknown impacts, partial writes, duplicates, or schedule failures', () => {
    const logEvents = Array.from({ length: 30 }, (_, index) => previewEvent(index));
    logEvents.push(previewEvent(30, { status: 'provider_error', reasonCode: 'provider_error' }));
    logEvents.push(previewEvent(31, { status: 'invalid_response', reasonCode: 'TASK_AI_DRAFT_UNKNOWN_IMPACT' }));
    logEvents.push({
        observedAt: '2026-08-11T09:00:00.000Z',
        source: 'logs',
        event: { type: 'commit', status: 'error', reasonCode: 'commit_error' }
    });

    const built = report.buildReport({
        logEvents,
        dbEvidence: {
            available: true,
            events: [],
            checks: {
                duplicateCommits: 1,
                partialImpactWrites: 1,
                partialSubtaskWrites: 0,
                partialBundleWrites: 1,
                schedulePlacementFailures: 1
            }
        },
        options: { hours: 24, minProposals: 30, providerErrorRateMax: 0.01 }
    });

    assert.equal(built.verdict.status, 'hold');
    assert.equal(built.verdict.gates.providerErrorRate, false);
    assert.equal(built.verdict.gates.unknownImpactIds, false);
    assert.equal(built.verdict.gates.partialWrites, false);
    assert.equal(built.verdict.gates.duplicateCommits, false);
    assert.equal(built.verdict.gates.schedulePlacementFailures, false);
    assert.equal(built.telemetry.providerFailures, 2);
});

test('task AI rollout provider latency excludes database zero-latency rows', () => {
    const built = report.buildReport({
        logEvents: [
            previewEvent(0, { latencyMs: 400, correlationId: 'provider-1' }),
            {
                observedAt: '2026-08-10T02:00:00.000Z',
                source: 'logs',
                event: { type: 'commit', status: 'success', latencyMs: 25, correlationId: 'commit-1' }
            }
        ],
        dbEvidence: {
            available: true,
            events: [{
                observedAt: '2026-08-10T02:00:00.000Z',
                source: 'database',
                event: { type: 'commit', status: 'success', latencyMs: 0, correlationId: 'commit-db' }
            }],
            checks: {
                duplicateCommits: 0,
                partialImpactWrites: 0,
                partialSubtaskWrites: 0,
                partialBundleWrites: 0,
                schedulePlacementFailures: 0
            }
        },
        options: { hours: 24, minProposals: 1, providerErrorRateMax: 0.05 }
    });

    assert.equal(built.telemetry.latencyMs.providerPreview.p50, 400);
    assert.equal(built.telemetry.latencyMs.commit.p50, 25);
});

test('task AI rollout database evidence uses only read-only queries and never falls back to DATABASE_URL', async () => {
    assert.throws(
        () => report.poolFromEnv?.({ DATABASE_URL: 'postgres://production.invalid/app' }),
        /TASK_AI_ROLLOUT_DATABASE_URL/
    );

    const calls = [];
    const fakePool = {
        async connect() {
            return {
                async query(text, params) {
                    calls.push({ text, params });
                    assert.doesNotMatch(text, /\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE)\b/i);
                    if (/SELECT h\.action_type/.test(text)) {
                        return {
                            rows: [{
                                action_type: 'task_ai_draft_committed',
                                source_surface: 'task_ai_draft_commit',
                                created_at: '2026-08-10T10:00:00.000Z',
                                actor_user_id: 7,
                                new_value_json: { changedFields: ['title'], impactCount: 1, subtaskCount: 0 },
                                meta_json: { model: 'gpt-5.6-luna', idempotencyKey: 'idem-1' },
                                business_context: 'event_genix'
                            }]
                        };
                    }
                    return { rows: [{ count: 0 }] };
                },
                release() {}
            };
        },
        async query(text, params) {
            calls.push({ text, params });
            assert.doesNotMatch(text, /\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE)\b/i);
            if (/SELECT h\.action_type/.test(text)) {
                return {
                    rows: [{
                        action_type: 'task_ai_draft_committed',
                        source_surface: 'task_ai_draft_commit',
                        created_at: '2026-08-10T10:00:00.000Z',
                        actor_user_id: 7,
                        new_value_json: { changedFields: ['title'], impactCount: 1, subtaskCount: 0 },
                        meta_json: { model: 'gpt-5.6-luna', idempotencyKey: 'idem-1' },
                        business_context: 'event_genix'
                    }]
                };
            }
            return { rows: [{ count: 0 }] };
        }
    };

    const evidence = await report.collectDatabaseEvidence({
        pool: fakePool,
        hours: 24,
        businessContext: 'event_genix'
    });

    assert.equal(evidence.available, true);
    assert.equal(evidence.events.length, 1);
    assert.equal(evidence.checks.duplicateCommits, 0);
    assert.ok(calls.length >= 5);
    assert.ok(calls.some(call => /BEGIN READ ONLY/.test(call.text)));
    assert.ok(calls.some(call => /SET TRANSACTION READ ONLY/.test(call.text)));
});

test('task AI rollout parser fails closed on empty or unrecognized operator input', () => {
    assert.deepEqual(report.parseTelemetryLogText(''), []);
    assert.deepEqual(report.parseTelemetryLogText('random railway line without telemetry'), []);
});

test('task AI rollout telemetry sanitizer rejects sensitive fields before logging', () => {
    const telemetry = require('../services/taskAiDraftTelemetry');
    assert.throws(
        () => telemetry.assertNoSensitiveTelemetryFields({
            type: 'preview',
            status: 'success',
            title: 'Sensitive CRM task'
        }),
        /sensitive fields/i
    );
});

test('task AI rollout Railway collector builds a no-raw-file command', () => {
    const args = collector.buildRailwayLogsArgs({
        service: '8223324090',
        environment: 'production',
        deploymentId: 'deployment-current',
        lines: '500',
        filter: 'task_ai_draft_event'
    });
    assert.deepEqual(args, [
        'logs',
        '--json',
        '--service',
        '8223324090',
        '--environment',
        'production',
        'deployment-current',
        '--lines',
        '500',
        '--filter',
        'task_ai_draft_event'
    ]);
});

test('task AI rollout report markdown is redacted and operator-readable', () => {
    const built = report.buildReport({
        logEvents: [
            previewEvent(0, { acceptedFieldMask: ['title', 'description'], taskCount: 1 }),
            previewEvent(1, { fallbackReason: 'malformed_response' }),
            previewEvent(2, { fallbackReason: 'invalid_impacts', impactFilterReason: 'filter_known_active', filteredImpactCount: 2 })
        ],
        dbEvidence: { available: false, events: [], checks: null },
        options: { hours: 24, minProposals: 30, providerErrorRateMax: 0.05 }
    });
    const markdown = report.reportMarkdown(built);
    assert.match(markdown, /Task AI rollout report/);
    assert.match(markdown, /version\/SHA/);
    assert.match(markdown, /stage/);
    assert.match(markdown, /successful proposals/);
    assert.match(markdown, /fallback proposals: 1/);
    assert.match(markdown, /validation-filtered events: 1/);
    assert.match(markdown, /"malformed_response":1/);
    assert.match(markdown, /"invalid_impacts":1/);
    assert.match(markdown, /Missing evidence/);
    assert.doesNotMatch(markdown, /title text|description text|OPENAI_API_KEY|proposalToken/i);
});

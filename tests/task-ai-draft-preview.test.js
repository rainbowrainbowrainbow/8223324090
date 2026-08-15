'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const preview = require('../services/taskAiDraftPreview');
const openAIClient = require('../services/myDayTaskOpenAIClient');
const telemetry = require('../services/taskAiDraftTelemetry');

const impacts = [
    { id: 101, name: 'Work: CRM', icon: '🗂️', isActive: true },
    { id: 102, name: 'Work: Hermes', icon: '⚡', isActive: true },
    { id: 103, name: 'Archived impact', icon: 'x', isActive: false }
];

function validProposal(overrides = {}) {
    return {
        decision: 'checklist',
        mode: 'checklist',
        title: 'Fix CRM booking form',
        description: 'Make booking validation clear and safe.',
        impactIds: [101],
        subtasks: [
            { title: 'Reproduce invalid booking submit' },
            { title: 'Patch validation handling' },
            { title: 'Verify CRM booking form' }
        ],
        confidence: {
            overall: 0.86,
            title: 0.92,
            description: 0.82,
            impacts: 0.88,
            subtasks: 0.8,
            mode: 0.84
        },
        reason: 'CRM validation task with clear checklist steps.',
        bundleTitle: null,
        tasks: [],
        ...overrides
    };
}

test('task AI draft preview uses one direct Luna Responses call with strict schema, safety id, diff, and signed token', async () => {
    const calls = [];
    const result = await preview.generateTaskAiDraftPreview({
        draft: {
            title: 'crm form',
            description: 'broken submit',
            mode: 'simple',
            scheduleDate: '2026-08-10',
            impactIds: []
        },
        impacts,
        userId: 7,
        businessScope: { businessContext: 'event_genix' }
    }, {
        proposalSecret: 'proposal-secret',
        safetySecret: 'safety-secret',
        safetyIdentifier: 'safe-user-hash',
        openAIClient: async request => {
            calls.push(request);
            return {
                ok: true,
                provider: 'openai',
                model: request.model,
                payload: {
                    output_text: JSON.stringify(validProposal()),
                    usage: { total_tokens: 123 }
                },
                usage: { total_tokens: 123 }
            };
        }
    });

    assert.equal(result.ok, true);
    assert.equal(result.provider, 'openai');
    assert.equal(result.model, 'gpt-5.6-luna');
    assert.equal(result.contractVersion, 'my_day_ai_composer_proposal_v2');
    assert.equal(result.proposal.decision, 'checklist');
    assert.equal(result.proposal.action, 'apply');
    assert.deepEqual(result.proposal.impactIds, [101]);
    assert.equal(result.proposal.subtasks.length, 3);
    assert.match(result.proposalToken, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    assert.equal(result.proposalHash, preview.proposalHash(result.proposal));
    assert.equal(result.diff.fields.title.changed, true);
    assert.equal(result.diff.fields.impactIds.changed, true);
    assert.equal(result.diff.fields.scheduleDate.changed, false);
    assert.equal(result.diff.changedFields.includes('subtasks'), true);
    assert.equal(result.draftFingerprint, preview.draftFingerprint({
        title: 'crm form',
        description: 'broken submit',
        mode: 'simple',
        scheduleDate: '2026-08-10',
        impactIds: []
    }));

    assert.equal(calls.length, 1);
    const request = calls[0];
    assert.equal(request.model, 'gpt-5.6-luna');
    assert.equal(request.schemaName, 'my_day_task_draft_preview');
    assert.equal(request.schema.additionalProperties, false);
    assert.deepEqual(request.schema.required, [
        'decision',
        'mode',
        'title',
        'description',
        'impactIds',
        'subtasks',
        'bundleTitle',
        'tasks',
        'confidence',
        'reason'
    ]);
    assert.deepEqual(request.schema.properties.decision.enum, [
        'single_task',
        'checklist',
        'task_bundle',
        'needs_clarification',
        'no_change'
    ]);
    assert.equal(request.schema.properties.impactIds.maxItems, 5);
    assert.equal(Object.hasOwn(request.schema.properties.impactIds, 'uniqueItems'), false);
    assert.equal(request.schema.properties.tasks.maxItems, 6);
    assert.equal(request.schema.properties.tasks.items.additionalProperties, false);
    assert.ok(request.schema.properties.tasks.items.required.includes('scheduleDate'));
    assert.equal(request.schema.properties.tasks.items.properties.impactIds.maxItems, 5);
    assert.equal(Object.hasOwn(request.schema.properties.tasks.items.properties.impactIds, 'uniqueItems'), false);
    assert.equal(request.reasoningEffort, 'low');
    assert.equal(request.maxOutputTokens, preview.TASK_AI_DRAFT_MAX_OUTPUT_TOKENS);
    assert.equal(request.safetyIdentifier, 'safe-user-hash');

    const serializedInput = JSON.stringify(request.input);
    const userMessage = JSON.parse(request.input[1].content[0].text);
    assert.match(serializedInput, /currentDraft/);
    assert.match(serializedInput, /activeImpacts/);
    assert.match(serializedInput, /serverExplicitImpactIds/);
    assert.deepEqual(userMessage.serverExplicitImpactIds, [101]);
    assert.equal(userMessage.currentDraft.scheduleDate, '2026-08-10');
    assert.match(serializedInput, /server will compute the diff|server/i);
    assert.match(serializedInput, /Do not output tags, directions/);
    assert.match(serializedInput, /scheduled, assigned, and completed independently/);
    assert.match(serializedInput, /explicitly asks for multiple separate, independent, or full tasks/);
    assert.match(serializedInput, /untrusted task data/);
    assert.match(serializedInput, /context \+ activity \+ outcome/);
    assert.match(serializedInput, /Do not return only the context/);
    assert.match(serializedInput, /do not clarify merely because more than 5 impacts/i);
    assert.match(serializedInput, /ownerSuggestion\.userId to null/);
    assert.doesNotMatch(serializedInput, /OPENAI_API_KEY|OPENROUTER_API_KEY|chat_ai/i);

    const token = preview.verifyProposalToken(result.proposalToken, {
        secret: 'proposal-secret',
        userId: 7,
        businessScope: { businessContext: 'event_genix' },
        audience: preview.TASK_AI_DRAFT_SINGLE_COMMIT_AUDIENCE,
        allowedDecisions: ['single_task', 'checklist']
    });
    assert.equal(token.contractVersion, preview.TASK_AI_DRAFT_CONTRACT_VERSION);
    assert.equal(token.audience, preview.TASK_AI_DRAFT_SINGLE_COMMIT_AUDIENCE);
    assert.equal(token.decision, 'checklist');
    assert.equal(token.scheduleDate, '2026-08-10');
});

test('task AI preview deterministically preserves explicit active impacts for single/checklist proposals', () => {
    const merged = preview.mergeServerExplicitImpacts({
        ...validProposal(),
        impactIds: [102]
    }, {
        title: 'CRM and Hermes integration',
        description: ''
    }, impacts);
    assert.deepEqual(merged.impactIds, [101, 102]);

    const clarification = preview.mergeServerExplicitImpacts({
        ...validProposal(),
        decision: 'needs_clarification',
        mode: null,
        impactIds: []
    }, { title: 'CRM 3321' }, impacts);
    assert.deepEqual(clarification.impactIds, [], 'clarification must not silently apply deterministic classification');

    const expandedImpacts = [
        ...impacts,
        { id: 104, name: 'Документи / право', icon: 'legal', isActive: true },
        { id: 105, name: 'Партнерства / нетворкінг', icon: 'network', isActive: true },
        { id: 106, name: 'Ризики / безпека', icon: 'security', isActive: true }
    ];
    const recovered = preview.mergeServerExplicitImpacts({
        ...validProposal(),
        decision: 'needs_clarification',
        mode: null,
        title: null,
        description: null,
        impactIds: []
    }, {
        title: 'Підготувати договір з новим партнером та перевірити ризики',
        description: 'Узгодити юридичні умови партнерства і перевірити безпеку.',
        impactIds: []
    }, expandedImpacts);
    assert.equal(recovered.decision, 'single_task');
    assert.equal(recovered.action, 'apply');
    assert.deepEqual(recovered.impactIds, [104, 105, 106]);
    assert.equal(recovered.confidence.impacts, 0.9);
    assert.match(recovered.reason, /recovered explicit active impacts/);
});

test('task AI preview separates structural mode from taskMode and diffs existing subtasks', () => {
    const currentDraft = {
        title: 'Р’С–РґСЂРµРјРѕРЅС‚СѓРІР°С‚Рё AI РґР»СЏ С‡РµРєР»С–СЃС‚С–РІ',
        description: 'Р„ РґРІР° СЂСѓС‡РЅС– РїСѓРЅРєС‚Рё, AI РјР°С” РїРѕРєР°Р·Р°С‚Рё before/after.',
        mode: 'work',
        taskMode: 'personal',
        taskKind: 'checklist',
        subtasks: [
            { title: 'Р—Р±РµСЂРµРіС‚Рё СЂСѓС‡РЅРёР№ РїСѓРЅРєС‚ 1' },
            { title: 'Р—Р±РµСЂРµРіС‚Рё СЂСѓС‡РЅРёР№ РїСѓРЅРєС‚ 2' }
        ],
        impactIds: [101]
    };
    const proposal = {
        ...validProposal(),
        subtasks: [
            { title: 'AI РїСѓРЅРєС‚ 1' },
            { title: 'AI РїСѓРЅРєС‚ 2' },
            { title: 'AI РїСѓРЅРєС‚ 3' }
        ]
    };

    const snapshot = preview.normalizeDraftSnapshot(currentDraft);
    const diff = preview.buildDraftDiff(currentDraft, proposal);

    assert.equal(snapshot.mode, 'checklist');
    assert.equal(snapshot.taskMode, 'personal');
    assert.deepEqual(snapshot.subtasks.map(item => item.title), [
        'Р—Р±РµСЂРµРіС‚Рё СЂСѓС‡РЅРёР№ РїСѓРЅРєС‚ 1',
        'Р—Р±РµСЂРµРіС‚Рё СЂСѓС‡РЅРёР№ РїСѓРЅРєС‚ 2'
    ]);
    assert.deepEqual(diff.fields.subtasks.before.map(item => item.title), [
        'Р—Р±РµСЂРµРіС‚Рё СЂСѓС‡РЅРёР№ РїСѓРЅРєС‚ 1',
        'Р—Р±РµСЂРµРіС‚Рё СЂСѓС‡РЅРёР№ РїСѓРЅРєС‚ 2'
    ]);
    assert.deepEqual(diff.fields.subtasks.after.map(item => item.title), ['AI РїСѓРЅРєС‚ 1', 'AI РїСѓРЅРєС‚ 2', 'AI РїСѓРЅРєС‚ 3']);
    assert.equal(diff.fields.subtasks.changed, true);
    assert.notEqual(
        preview.draftFingerprint({ ...currentDraft, subtasks: currentDraft.subtasks.slice(0, 1) }),
        preview.draftFingerprint(currentDraft)
    );
});

test('task AI preview telemetry records only metadata and strips task text/provider payloads', async () => {
    const events = [];
    const result = await preview.generateTaskAiDraftPreview({
        draft: {
            title: 'Sensitive CRM customer title',
            description: 'Sensitive customer description',
            mode: 'simple',
            impactIds: []
        },
        impacts,
        userId: 7,
        businessScope: { businessContext: 'event_genix' }
    }, {
        proposalSecret: 'proposal-secret',
        safetySecret: 'safety-secret',
        telemetry: {
            logger: {
                info: (message, data) => events.push({ message, data })
            }
        },
        openAIClient: async request => ({
            ok: true,
            provider: 'openai',
            model: request.model,
            payload: {
                output_text: JSON.stringify(validProposal()),
                usage: { input_tokens: 41, output_tokens: 52, total_tokens: 93 }
            },
            usage: { input_tokens: 41, output_tokens: 52, total_tokens: 93 }
        })
    });

    assert.equal(result.ok, true);
    assert.equal(events.length, 1);
    assert.equal(events[0].message, 'task_ai_draft_event');
    assert.equal(events[0].data.status, 'success');
    assert.equal(events[0].data.model, 'gpt-5.6-luna');
    assert.equal(events[0].data.promptVersion, preview.TASK_AI_DRAFT_PROMPT_VERSION);
    assert.deepEqual(events[0].data.changedFields.sort(), ['description', 'impactIds', 'mode', 'subtasks', 'title'].sort());
    assert.deepEqual(events[0].data.usage, { inputTokens: 41, outputTokens: 52, totalTokens: 93 });
    const serialized = JSON.stringify(events[0].data);
    assert.doesNotMatch(serialized, /Sensitive CRM customer title|Sensitive customer description|output_text|Bearer|OPENAI_API_KEY/i);

    assert.throws(
        () => telemetry.recordTaskAiDraftTelemetry({ type: 'preview', status: 'success', promptText: 'secret task text' }),
        /sensitive fields/i
    );

    const bundleEvent = telemetry.recordTaskAiDraftTelemetry({
        type: 'bundle_commit',
        status: 'success',
        taskCount: 4,
        acceptedTaskCount: 3,
        rejectedTaskCount: 1,
        editedTaskCount: 2,
        replay: false
    }, {
        logger: { info: () => {} }
    });
    assert.equal(bundleEvent.type, 'bundle_commit');
    assert.equal(bundleEvent.taskCount, 4);
    assert.equal(bundleEvent.acceptedTaskCount, 3);
    assert.equal(bundleEvent.rejectedTaskCount, 1);
    assert.equal(bundleEvent.editedTaskCount, 2);

    const unknownEvent = telemetry.sanitizeTelemetryEvent({ type: 'new_future_type', status: 'success' });
    assert.equal(unknownEvent.type, 'unknown');

    const aggregate = telemetry.aggregateTaskAiDraftTelemetry([
        bundleEvent,
        { type: 'bundle_commit', status: 'replayed', taskCount: 4, acceptedTaskCount: 3, replay: true }
    ]);
    assert.equal(aggregate.byType.bundle_commit, 2);
    assert.equal(aggregate.taskCount, 8);
    assert.equal(aggregate.acceptedTaskCount, 6);
    assert.equal(aggregate.replayed, 1);
});

test('task AI draft preview returns clarification/no-change decisions without inventing subtasks', async () => {
    const clarification = await preview.generateTaskAiDraftPreview({
        draft: { title: '3321' },
        impacts,
        userId: 7
    }, {
        proposalSecret: 'secret',
        openAIClient: async () => ({
            ok: true,
            provider: 'openai',
            model: 'gpt-5.6-luna',
            text: JSON.stringify(validProposal({
                decision: 'needs_clarification',
                mode: null,
                title: null,
                description: null,
                impactIds: [],
                subtasks: [],
                confidence: {
                    overall: 0.3,
                    title: 0.2,
                    description: 0.1,
                    impacts: 0.2,
                    subtasks: 0.1,
                    mode: 0.2
                },
                reason: 'Need a clearer task goal.'
            }))
        })
    });
    assert.equal(clarification.ok, true);
    assert.equal(clarification.proposal.decision, 'needs_clarification');
    assert.equal(clarification.proposal.action, 'needs_clarification');
    assert.deepEqual(clarification.proposal.subtasks, []);

    const inventedClarification = await preview.generateTaskAiDraftPreview({
        draft: { title: 'unclear' },
        impacts,
        userId: 7
    }, {
        proposalSecret: 'secret',
        openAIClient: async () => ({
            ok: true,
            provider: 'openai',
            model: 'gpt-5.6-luna',
            text: JSON.stringify(validProposal({
                decision: 'needs_clarification',
                mode: null,
                title: null,
                description: null,
                impactIds: [],
                subtasks: [{ title: 'Invented step' }],
                reason: 'Need clarification.'
            }))
        })
    });
    assert.equal(inventedClarification.ok, false);
    assert.equal(inventedClarification.code, 'TASK_AI_DRAFT_INVALID_RESPONSE');
});

test('task AI draft preview returns task bundle proposals with review-only task fields and signed token', async () => {
    const result = await preview.generateTaskAiDraftPreview({
        draft: {
            title: 'Launch CRM + Hermes automation plan',
            description: 'Need a proper rollout with analytics and owner review.'
        },
        impacts,
        userId: 7,
        businessScope: { businessContext: 'event_genix' }
    }, {
        proposalSecret: 'proposal-secret',
        openAIClient: async () => ({
            ok: true,
            provider: 'openai',
            model: 'gpt-5.6-luna',
            text: JSON.stringify(validProposal({
                decision: 'task_bundle',
                mode: null,
                title: null,
                description: null,
                impactIds: [],
                subtasks: [],
                bundleTitle: 'CRM + Hermes automation rollout',
                tasks: [
                    {
                        title: 'Fix CRM intake form',
                        description: 'Make CRM booking intake reliable before automation.',
                        impactIds: [101],
                        subtasks: [],
                        priority: 'high',
                        scheduleDate: '2026-08-20',
                        ownerSuggestion: {
                            userId: null,
                            name: 'CRM owner',
                            reason: 'Requires explicit human review before assignment.'
                        },
                        confidence: {
                            overall: 0.9,
                            title: 0.94,
                            description: 0.86,
                            impacts: 0.92,
                            subtasks: 0.7,
                            mode: 0.82
                        }
                    },
                    {
                        title: 'Wire Hermes worker to CRM event',
                        description: 'Connect Hermes processing after CRM form validation.',
                        impactIds: [102],
                        subtasks: [],
                        priority: 'normal',
                        scheduleDate: null,
                        ownerSuggestion: {
                            userId: null,
                            name: null,
                            reason: null
                        },
                        confidence: {
                            overall: 0.88,
                            title: 0.9,
                            description: 0.84,
                            impacts: 0.9,
                            subtasks: 0.7,
                            mode: 0.8
                        }
                    }
                ],
                confidence: {
                    overall: 0.88,
                    title: 0.85,
                    description: 0.82,
                    impacts: 0.9,
                    subtasks: 0.7,
                    mode: 0.8
                },
                reason: 'The input contains two separate deliverables.'
            }))
        })
    });

    assert.equal(result.ok, true);
    assert.equal(result.proposal.decision, 'task_bundle');
    assert.equal(result.proposal.action, 'needs_project');
    assert.equal(result.proposal.bundleTitle, 'CRM + Hermes automation rollout');
    assert.equal(result.proposal.tasks.length, 2);
    assert.deepEqual(result.proposal.tasks[0].impactIds, [101]);
    assert.equal(result.proposal.tasks[0].priority, 'high');
    assert.equal(result.proposal.tasks[0].scheduleDate, '2026-08-20');
    assert.equal(result.proposal.tasks[0].ownerSuggestion.userId, null);
    assert.equal(result.diff.fields.tasks.changed, true);
    assert.equal(result.diff.changedFields.includes('tasks'), true);

    const token = preview.verifyProposalToken(result.proposalToken, {
        secret: 'proposal-secret',
        userId: 7,
        businessScope: { businessContext: 'event_genix' },
        draftFingerprint: result.draftFingerprint,
        proposal: result.proposal,
        catalogVersion: result.catalogVersion
    });
    assert.equal(token.contractVersion, 'my_day_ai_composer_proposal_v2');
    assert.equal(token.audience, preview.TASK_AI_DRAFT_BUNDLE_COMMIT_AUDIENCE);
    assert.equal(token.decision, 'task_bundle');
    assert.equal(token.proposalHash, preview.proposalHash(result.proposal));
});

test('task AI draft preview rejects invalid task bundle shape and unsafe task fields', async () => {
    const oneTaskBundle = await preview.generateTaskAiDraftPreview({
        draft: { title: 'Split CRM plan' },
        impacts,
        userId: 7
    }, {
        proposalSecret: 'secret',
        openAIClient: async () => ({
            ok: true,
            provider: 'openai',
            model: 'gpt-5.6-luna',
            text: JSON.stringify(validProposal({
                decision: 'task_bundle',
                mode: null,
                title: null,
                description: null,
                impactIds: [],
                subtasks: [],
                bundleTitle: 'Too small bundle',
                tasks: [{
                    title: 'Only one task',
                    description: null,
                    impactIds: [101],
                    subtasks: [],
                    priority: 'normal',
                    scheduleDate: null,
                    ownerSuggestion: { userId: null, name: null, reason: null },
                    confidence: validProposal().confidence
                }]
            }))
        })
    });
    assert.equal(oneTaskBundle.ok, false);
    assert.equal(oneTaskBundle.code, 'TASK_AI_DRAFT_INVALID_RESPONSE');

    const archivedTaskImpact = await preview.generateTaskAiDraftPreview({
        draft: { title: 'Split CRM plan' },
        impacts,
        userId: 7
    }, {
        proposalSecret: 'secret',
        openAIClient: async () => ({
            ok: true,
            provider: 'openai',
            model: 'gpt-5.6-luna',
            text: JSON.stringify(validProposal({
                decision: 'task_bundle',
                mode: null,
                title: null,
                description: null,
                impactIds: [],
                subtasks: [],
                bundleTitle: 'CRM plan',
                tasks: [
                    {
                        title: 'Task one',
                        description: null,
                        impactIds: [101],
                        subtasks: [],
                        priority: 'normal',
                        scheduleDate: null,
                        ownerSuggestion: { userId: null, name: null, reason: null },
                        confidence: validProposal().confidence
                    },
                    {
                        title: 'Task two',
                        description: null,
                        impactIds: [103],
                        subtasks: [],
                        priority: 'normal',
                        scheduleDate: null,
                        ownerSuggestion: { userId: null, name: null, reason: null },
                        confidence: validProposal().confidence
                    }
                ]
            }))
        })
    });
    assert.equal(archivedTaskImpact.ok, false);
    assert.equal(archivedTaskImpact.code, 'TASK_AI_DRAFT_UNKNOWN_IMPACT');

    const invalidDueDate = await preview.generateTaskAiDraftPreview({
        draft: { title: 'Split CRM plan' },
        impacts,
        userId: 7
    }, {
        proposalSecret: 'secret',
        openAIClient: async () => ({
            ok: true,
            provider: 'openai',
            model: 'gpt-5.6-luna',
            text: JSON.stringify(validProposal({
                decision: 'task_bundle',
                mode: null,
                title: null,
                description: null,
                impactIds: [],
                subtasks: [],
                bundleTitle: 'CRM plan',
                tasks: [
                    {
                        title: 'Task one',
                        description: null,
                        impactIds: [101],
                        subtasks: [],
                        priority: 'normal',
                        scheduleDate: 'tomorrow',
                        ownerSuggestion: { userId: null, name: null, reason: null },
                        confidence: validProposal().confidence
                    },
                    {
                        title: 'Task two',
                        description: null,
                        impactIds: [102],
                        subtasks: [],
                        priority: 'normal',
                        scheduleDate: null,
                        ownerSuggestion: { userId: null, name: null, reason: null },
                        confidence: validProposal().confidence
                    }
                ]
            }))
        })
    });
    assert.equal(invalidDueDate.ok, false);
    assert.equal(invalidDueDate.code, 'TASK_AI_DRAFT_INVALID_RESPONSE');

    const inventedOwner = await preview.generateTaskAiDraftPreview({
        draft: { title: 'Split CRM plan' },
        impacts,
        userId: 7
    }, {
        proposalSecret: 'secret',
        openAIClient: async () => ({
            ok: true,
            provider: 'openai',
            model: 'gpt-5.6-luna',
            text: JSON.stringify(validProposal({
                decision: 'task_bundle',
                mode: null,
                title: null,
                description: null,
                impactIds: [],
                subtasks: [],
                bundleTitle: 'CRM plan',
                tasks: [
                    {
                        title: 'Task one',
                        description: null,
                        impactIds: [101],
                        subtasks: [],
                        priority: 'normal',
                        scheduleDate: null,
                        ownerSuggestion: { userId: 999, name: 'Invented owner', reason: 'Unsafe.' },
                        confidence: validProposal().confidence
                    },
                    {
                        title: 'Task two',
                        description: null,
                        impactIds: [102],
                        subtasks: [],
                        priority: 'normal',
                        scheduleDate: null,
                        ownerSuggestion: { userId: null, name: null, reason: null },
                        confidence: validProposal().confidence
                    }
                ]
            }))
        })
    });
    assert.equal(inventedOwner.ok, false);
    assert.equal(inventedOwner.code, 'TASK_AI_DRAFT_INVALID_RESPONSE');
});

test('task AI draft preview rejects unknown or archived impacts and extra fields', async () => {
    const unknown = await preview.generateTaskAiDraftPreview({
        draft: { title: 'Fix CRM and archived thing' },
        impacts,
        userId: 7
    }, {
        proposalSecret: 'secret',
        openAIClient: async () => ({
            ok: true,
            provider: 'openai',
            model: 'gpt-5.6-luna',
            text: JSON.stringify(validProposal({ impactIds: [101, 103] }))
        })
    });
    assert.equal(unknown.ok, false);
    assert.equal(unknown.code, 'TASK_AI_DRAFT_UNKNOWN_IMPACT');

    const extra = await preview.generateTaskAiDraftPreview({
        draft: { title: 'Fix CRM' },
        impacts,
        userId: 7
    }, {
        proposalSecret: 'secret',
        openAIClient: async () => ({
            ok: true,
            provider: 'openai',
            model: 'gpt-5.6-luna',
            text: JSON.stringify({ ...validProposal(), tags: ['crm'] })
        })
    });
    assert.equal(extra.ok, false);
    assert.equal(extra.code, 'TASK_AI_DRAFT_INVALID_RESPONSE');
});

test('shared My Day task OpenAI client enforces official production host and sends safe Responses payload', async () => {
    const blocked = await openAIClient.callMyDayTaskOpenAIResponses({
        model: 'gpt-5.6-luna',
        env: {
            NODE_ENV: 'production',
            OPENAI_API_KEY: 'secret',
            OPENAI_API_BASE_URL: 'https://proxy.invalid/v1'
        },
        input: [],
        schemaName: 'smoke',
        schema: { type: 'object', additionalProperties: false, required: [], properties: {} },
        maxOutputTokens: 10
    }, {
        fetchImpl: async () => {
            throw new Error('fetch must not be called for a non-official production host');
        }
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.reason, 'api_base_not_allowed');

    const requests = [];
    const ok = await openAIClient.callMyDayTaskOpenAIResponses({
        model: 'gpt-5.6-luna',
        env: {
            OPENAI_API_KEY: 'secret',
            OPENAI_API_BASE_URL: 'https://openai.test/v1'
        },
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'x' }] }],
        schemaName: 'smoke',
        schema: { type: 'object', additionalProperties: false, required: [], properties: {} },
        reasoningEffort: 'low',
        maxOutputTokens: 10,
        safetyIdentifier: 'safe-id'
    }, {
        fetchImpl: async (url, options) => {
            requests.push({ url, body: JSON.parse(options.body), authorization: options.headers.Authorization });
            return { ok: true, status: 200, json: async () => ({ output_text: '{}' }) };
        }
    });
    assert.equal(ok.ok, true);
    assert.equal(requests[0].url, 'https://openai.test/v1/responses');
    assert.equal(requests[0].body.model, 'gpt-5.6-luna');
    assert.equal(requests[0].body.store, false);
    assert.equal(requests[0].body.safety_identifier, 'safe-id');
    assert.equal(requests[0].body.text.format.strict, true);
    assert.equal(requests[0].body.reasoning.effort, 'low');
    assert.equal(requests[0].authorization, 'Bearer secret');
});

test('shared My Day task OpenAI client blocks real network calls in test or CI without an injected mock transport', async () => {
    const blocked = await openAIClient.callMyDayTaskOpenAIResponses({
        model: 'gpt-5.6-luna',
        env: {
            NODE_ENV: 'test',
            OPENAI_API_KEY: 'sk-real-looking-test-key'
        },
        input: [],
        schemaName: 'smoke',
        schema: { type: 'object', additionalProperties: false, required: [], properties: {} },
        maxOutputTokens: 10
    });

    assert.equal(blocked.ok, false);
    assert.equal(blocked.reason, 'real_openai_blocked_in_tests');
    assert.equal(blocked.statusCode, 503);
});

test('shared My Day task OpenAI client does not classify an explicit Railway production runtime as test', () => {
    const env = {
        NODE_ENV: 'test',
        CI: 'true',
        RAILWAY_ENVIRONMENT: 'production',
        RAILWAY_ENVIRONMENT_NAME: 'production'
    };

    assert.equal(openAIClient.isTestRuntime(env), false);
    assert.equal(openAIClient.shouldBlockRealOpenAIInTests(env, {
        apiBase: 'https://api.openai.com/v1'
    }), false);
});

test('shared My Day task OpenAI client allows loopback OpenAI mock in test runtime', async () => {
    const requests = [];
    const response = await openAIClient.callMyDayTaskOpenAIResponses({
        model: 'gpt-5.6-luna',
        env: {
            NODE_ENV: 'test',
            OPENAI_API_KEY: 'isolated-my-day-openai-mock-key',
            OPENAI_API_BASE_URL: 'http://127.0.0.1:43123/v1'
        },
        input: [],
        schemaName: 'smoke',
        schema: { type: 'object', additionalProperties: false, required: [], properties: {} },
        maxOutputTokens: 10
    }, {
        fetchImpl: async (url, options) => {
            requests.push({ url, body: JSON.parse(options.body) });
            return { ok: true, status: 200, json: async () => ({ output_text: '{}' }) };
        }
    });

    assert.equal(response.ok, true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'http://127.0.0.1:43123/v1/responses');
    assert.equal(requests[0].body.store, false);
});

test('tasks route exposes ai-draft preview and keeps decompose-draft as non-OpenRouter compatibility wrapper for AI mode', () => {
    const route = fs.readFileSync(path.join(root, 'routes', 'tasks.js'), 'utf8');
    const decomposeBlock = route.slice(route.indexOf("router.post('/decompose-draft'"), route.indexOf("router.get('/decomposition-saved-templates'"));

    assert.match(route, /router\.post\('\/ai-draft\/preview'/);
    assert.match(route, /generateTaskAiDraftPreview/);
    assert.match(route, /loadMyDayAiImpactCatalog\(pool, userId\)/);
    assert.match(route, /listTaskOwnerCandidates\(\{ actor: req\.user \}\)/);
    assert.match(route, /ownerCatalog: ownerCatalog\.map/);
    assert.match(route, /currentUserId: userId/);
    assert.match(route, /hmacSafetyIdentifier\(`task_ai_draft:\$\{userId\}`/);
    assert.match(decomposeBlock, /legacyDecompositionResponseFromPreview/);
    assert.match(decomposeBlock, /deprecatedEndpoint: '\/api\/tasks\/ai-draft\/preview'/);
    assert.match(decomposeBlock, /legacy_decompose_wrapper_used/);
    assert.match(decomposeBlock, /legacy_decompose_wrapper_non_apply/);
    assert.match(decomposeBlock, /TASK_AI_DRAFT_\$\{String\(preview\.proposal\?\.action/);
    assert.doesNotMatch(decomposeBlock, /callUnifiedChatCompletion|OPENROUTER_API_KEY|scope: 'chat_ai'/);
});

test('legacy task-create AI decomposition UI uses canonical ai-draft preview rail for AI modes', () => {
    const taskCreate = fs.readFileSync(path.join(root, 'js', 'task-create.js'), 'utf8');
    const requestStart = taskCreate.indexOf('async function requestDecompositionDraft');
    const requestBlock = taskCreate.slice(requestStart, taskCreate.indexOf('async function requestAiDraftPreview', requestStart));

    assert.match(taskCreate, /function aiPreviewToDecompositionDraft/);
    assert.match(requestBlock, /requestAiDraftPreview\(\{/);
    assert.match(requestBlock, /structurePreference: 'checklist'/);
    assert.match(requestBlock, /sourceSurface: context\.sourceSurface \|\| 'task_decomposition_legacy_ui'/);
    assert.match(requestBlock, /taskApiRequest\('\/tasks\/decompose-draft'/);
    assert.ok(requestBlock.indexOf('requestAiDraftPreview({') < requestBlock.indexOf("taskApiRequest('/tasks/decompose-draft'"));
});

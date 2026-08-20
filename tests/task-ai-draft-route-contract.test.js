'use strict';

const assert = require('node:assert/strict');
const express = require('express');
const test = require('node:test');

function installMock(modulePath, exports) {
    const id = require.resolve(modulePath);
    require.cache[id] = { id, filename: id, loaded: true, exports };
}

function clearRouteModules() {
    [
        '../db',
        '../middleware/auth',
        '../services/taskDecomposition',
        '../services/taskAiDraftPreview',
        '../services/taskAiDraftCommit',
        '../services/taskAiDraftBundleCommit',
        '../services/taskAiDraftFeatureGate',
        '../services/taskAiDraftLimiter',
        '../services/taskAiDraftTelemetry',
        '../services/myDayAiImpactCatalog',
        '../services/myDayTaxonomy',
        '../services/taskPolicy',
        '../services/taskBusinessScope',
        '../services/taskNotifications',
        '../services/telegram',
        '../routes/dashboard',
        '../routes/tasks'
    ].forEach(modulePath => {
        try { delete require.cache[require.resolve(modulePath)]; } catch {}
    });
}

function listen(app) {
    return new Promise(resolve => {
        const server = app.listen(0, '127.0.0.1', () => {
            resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` });
        });
    });
}

function close(server) {
    return new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
    });
}

function installBaseRouteMocks({
    activeImpacts = [],
    taskDecomposition = null,
    taskAiDraftPreview = null,
    telemetryEvents = []
} = {}) {
    installMock('../db', {
        pool: {
            async query() {
                return { rows: [] };
            }
        }
    });
    installMock('../middleware/auth', {
        JWT_SECRET: 'route-contract-secret',
        authenticateToken: (req, res, next) => {
            req.user = { id: 7, username: 'route-user', name: 'Route User', role: 'admin' };
            next();
        },
        requireRole: () => (req, res, next) => next(),
        canUseAction: () => true
    });
    installMock('../services/taskPolicy', {
        buildTaskOwnerMatch: () => 'TRUE',
        buildTaskVisibilityScope: () => '',
        canManageTaskObservers: () => true,
        canMutateTask: () => true,
        canReassignTask: () => true,
        normalizeUserId: user => Number(user?.id || user?.userId || 0),
        taskRouteCapabilityDecision: () => ({ allowed: true })
    });
    installMock('../services/taskBusinessScope', {
        activeTaskBusinessContext: scope => scope?.businessContext || scope?.business_context || 'event_genix',
        appendTaskBusinessScopeSql: () => '',
        ensureTaskBusinessScope: () => ({ businessContext: 'event_genix' }),
        ensureWritableTaskBusinessScope: () => ({ businessContext: 'event_genix' }),
        pushTaskBusinessScopeCondition: () => '',
        taskBusinessScopeMeta: scope => ({ businessContext: scope?.businessContext || 'event_genix' })
    });
    installMock('../services/taskDecomposition', taskDecomposition || {
        generateTaskDecompositionDraft: async () => {
            throw new Error('taskDecomposition should not be called by this test');
        },
        getTaskDecompositionTemplates: () => [],
        normalizeDecompositionMode: (value, fallback = 'manual') => {
            const raw = String(value || '').trim();
            return ['none', 'manual', 'template', 'ai', 'template_ai'].includes(raw) ? raw : fallback;
        }
    });
    installMock('../services/taskAiDraftFeatureGate', {
        assertTaskAiDraftBundleFeatureEnabled: () => true,
        assertTaskAiDraftFeatureEnabled: () => true,
        publicTaskAiDraftBundleFeatureStatus: () => ({ enabled: true }),
        publicTaskAiDraftFeatureStatus: () => ({ enabled: true })
    });
    installMock('../services/taskAiDraftLimiter', {
        checkTaskAiDraftRateLimit: async () => ({ allowed: true })
    });
    installMock('../services/taskAiDraftTelemetry', {
        recordTaskAiDraftTelemetry: event => {
            telemetryEvents.push(event);
            return event;
        }
    });
    installMock('../services/myDayAiImpactCatalog', {
        loadMyDayAiImpactCatalog: async () => ({ impacts: activeImpacts })
    });
    installMock('../services/myDayTaxonomy', {
        listTaxonomy: async () => activeImpacts
    });
    installMock('../services/taskAiDraftPreview', taskAiDraftPreview || {
        TASK_AI_DRAFT_SINGLE_COMMIT_AUDIENCE: 'task_ai_draft_commit',
        TASK_AI_DRAFT_BUNDLE_COMMIT_AUDIENCE: 'task_ai_draft_bundle_commit',
        generateTaskAiDraftPreview: async () => {
            throw new Error('taskAiDraftPreview should not be called by this test');
        },
        legacyDecompositionResponseFromPreview: () => ({ success: false })
    });
    installMock('../services/taskAiDraftCommit', {
        commitTaskAiDraft: async () => {
            throw new Error('commit route is not part of this test');
        }
    });
    installMock('../services/taskAiDraftBundleCommit', {
        commitTaskAiDraftBundle: async () => {
            throw new Error('bundle route is not part of this test');
        },
        readTaskBundleForUser: async () => null
    });
    installMock('../services/taskNotifications', {
        emitTaskAssignedToOwner: () => null
    });
    installMock('../services/telegram', {
        getConfiguredChatId: async () => null,
        sendTelegramMessage: async () => ({ ok: true })
    });
}

test('AI draft preview route uses the canonical preview handler and active impact catalog', async () => {
    clearRouteModules();
    const activeImpacts = [
        { id: 101, name: 'Work: CRM', icon: 'crm', color: '#2563eb', isActive: true },
        { id: 102, name: 'Automation / AI', icon: 'ai', color: '#16a34a', isActive: true }
    ];
    let capturedInput = null;
    let capturedOptions = null;

    installMock('../db', {
        pool: {
            async query() {
                return { rows: [] };
            }
        }
    });
    installMock('../middleware/auth', {
        JWT_SECRET: 'route-contract-secret',
        authenticateToken: (req, res, next) => {
            req.user = { id: 7, username: 'route-user', name: 'Route User', role: 'admin' };
            next();
        },
        requireRole: () => (req, res, next) => next(),
        canUseAction: () => true
    });
    installMock('../services/taskPolicy', {
        buildTaskOwnerMatch: () => 'TRUE',
        buildTaskVisibilityScope: () => '',
        canManageTaskObservers: () => true,
        canMutateTask: () => true,
        canReassignTask: () => true,
        normalizeUserId: user => Number(user?.id || user?.userId || 0),
        taskRouteCapabilityDecision: () => ({ allowed: true })
    });
    installMock('../services/taskBusinessScope', {
        activeTaskBusinessContext: scope => scope?.businessContext || scope?.business_context || 'event_genix',
        appendTaskBusinessScopeSql: () => '',
        ensureTaskBusinessScope: () => ({ businessContext: 'event_genix' }),
        ensureWritableTaskBusinessScope: () => ({ businessContext: 'event_genix' }),
        pushTaskBusinessScopeCondition: () => '',
        taskBusinessScopeMeta: scope => ({ businessContext: scope?.businessContext || 'event_genix' })
    });
    installMock('../services/taskAiDraftFeatureGate', {
        assertTaskAiDraftBundleFeatureEnabled: () => true,
        assertTaskAiDraftFeatureEnabled: () => true,
        publicTaskAiDraftBundleFeatureStatus: () => ({ enabled: true }),
        publicTaskAiDraftFeatureStatus: () => ({ enabled: true })
    });
    installMock('../services/taskAiDraftLimiter', {
        checkTaskAiDraftRateLimit: async () => ({ allowed: true })
    });
    installMock('../services/taskAiDraftTelemetry', {
        recordTaskAiDraftTelemetry: () => null
    });
    installMock('../services/myDayAiImpactCatalog', {
        loadMyDayAiImpactCatalog: async () => ({ impacts: activeImpacts })
    });
    installMock('../services/myDayTaxonomy', {
        listTaxonomy: async () => activeImpacts
    });
    installMock('../services/taskAiDraftPreview', {
        TASK_AI_DRAFT_SINGLE_COMMIT_AUDIENCE: 'task_ai_draft_commit',
        TASK_AI_DRAFT_BUNDLE_COMMIT_AUDIENCE: 'task_ai_draft_bundle_commit',
        generateTaskAiDraftPreview: async (input, options) => {
            capturedInput = input;
            capturedOptions = options;
            return {
                ok: true,
                provider: 'openai',
                model: 'gpt-5.6-luna',
                contractVersion: 'my_day_ai_composer_proposal_v2',
                proposal: {
                    decision: 'single_task',
                    action: 'apply',
                    mode: 'simple',
                    title: 'Fix CRM lead handoff',
                    description: 'Prepare a readable CRM lead handoff with owner risks and next actions.',
                    impactIds: [101],
                    subtasks: [],
                    confidence: { overall: 0.9 },
                    reason: 'Route contract fixture.'
                },
                impactCatalog: activeImpacts,
                proposalToken: 'token.signature',
                proposalHash: 'proposal-hash',
                draftFingerprint: 'draft-fingerprint',
                catalogVersion: 'catalog-version',
                diff: {
                    changedFields: ['title', 'description', 'impactIds'],
                    fields: {
                        title: { changed: true },
                        description: { changed: true },
                        impactIds: { changed: true }
                    }
                }
            };
        },
        legacyDecompositionResponseFromPreview: () => ({ success: false })
    });
    installMock('../services/taskAiDraftCommit', {
        commitTaskAiDraft: async () => {
            throw new Error('commit route is not part of this preview test');
        }
    });
    installMock('../services/taskAiDraftBundleCommit', {
        commitTaskAiDraftBundle: async () => {
            throw new Error('bundle route is not part of this preview test');
        },
        readTaskBundleForUser: async () => null
    });
    installMock('../services/taskNotifications', {
        emitTaskAssignedToOwner: () => null
    });
    installMock('../services/telegram', {
        getConfiguredChatId: async () => null,
        sendTelegramMessage: async () => ({ ok: true })
    });

    const router = require('../routes/tasks');
    const app = express();
    app.use(express.json());
    app.use('/api/tasks', router);
    const { server, baseUrl } = await listen(app);
    try {
        const response = await fetch(`${baseUrl}/api/tasks/ai-draft/preview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                currentDraft: {
                    title: 'crm handoff',
                    description: 'need owner risks and next actions',
                    impactIds: [101, 999_999]
                },
                structurePreference: 'simple',
                sourceSurface: 'profile_my_day'
            })
        });
        const payload = await response.json();

        assert.equal(response.status, 200, JSON.stringify(payload));
        assert.equal(payload.success, true);
        assert.equal(payload.proposal.description, 'Prepare a readable CRM lead handoff with owner risks and next actions.');
        assert.deepEqual(payload.proposal.impactIds, [101]);
        assert.deepEqual(payload.impactCatalog, activeImpacts);
        assert.equal(capturedInput.userId, 7);
        assert.equal(capturedInput.businessScope.businessContext, 'event_genix');
        assert.deepEqual(capturedInput.impacts, activeImpacts);
        assert.deepEqual(capturedInput.draft.impactIds, [101, 999999]);
        assert.equal(capturedInput.draft.title, 'crm handoff');
        assert.equal(capturedInput.draft.description, 'need owner risks and next actions');
        assert.equal(typeof capturedOptions.safetyIdentifier, 'string');
        assert.ok(capturedOptions.safetyIdentifier.length > 20);
    } finally {
        await close(server);
        clearRouteModules();
    }
});

test('legacy decompose-draft AI mode delegates exactly once to canonical preview and keeps safe compatibility telemetry', async () => {
    const realPreview = require('../services/taskAiDraftPreview');
    clearRouteModules();
    const activeImpacts = [
        { id: 101, name: 'Work: CRM', icon: 'crm', color: '#2563eb', isActive: true }
    ];
    const telemetryEvents = [];
    let previewCalls = 0;
    let decompositionCalls = 0;
    let capturedInput = null;

    installBaseRouteMocks({
        activeImpacts,
        telemetryEvents,
        taskDecomposition: {
            generateTaskDecompositionDraft: async () => {
                decompositionCalls += 1;
                return { success: false };
            },
            getTaskDecompositionTemplates: () => [],
            normalizeDecompositionMode: (value, fallback = 'manual') => {
                const raw = String(value || '').trim();
                return ['none', 'manual', 'template', 'ai', 'template_ai'].includes(raw) ? raw : fallback;
            }
        },
        taskAiDraftPreview: {
            TASK_AI_DRAFT_SINGLE_COMMIT_AUDIENCE: 'task_ai_draft_commit',
            TASK_AI_DRAFT_BUNDLE_COMMIT_AUDIENCE: 'task_ai_draft_bundle_commit',
            generateTaskAiDraftPreview: async input => {
                previewCalls += 1;
                capturedInput = input;
                return {
                    ok: true,
                    provider: 'openai',
                    model: 'gpt-5.6-luna',
                    contractVersion: 'my_day_ai_composer_proposal_v2',
                    promptVersion: '2026-08-13.5',
                    proposal: {
                        decision: 'checklist',
                        action: 'apply',
                        mode: 'checklist',
                        title: 'Readable CRM handoff',
                        description: 'Prepare a readable CRM lead handoff with owner risks and next actions.',
                        impactIds: [101],
                        subtasks: [
                            { title: 'Check lead card' },
                            { title: 'Write owner risks' }
                        ],
                        bundleTitle: null,
                        tasks: [],
                        confidence: { overall: 0.91 },
                        reason: 'Canonical route fixture.'
                    },
                    impactCatalog: activeImpacts,
                    proposalToken: 'token.signature',
                    proposalHash: 'proposal-hash',
                    draftFingerprint: 'draft-fingerprint',
                    catalogVersion: 'catalog-version',
                    diff: {
                        changedFields: ['title', 'description', 'impactIds', 'subtasks'],
                        fields: {
                            title: { changed: true },
                            description: { changed: true },
                            impactIds: { changed: true },
                            subtasks: { changed: true }
                        }
                    }
                };
            },
            legacyDecompositionResponseFromPreview: realPreview.legacyDecompositionResponseFromPreview
        }
    });

    const router = require('../routes/tasks');
    const app = express();
    app.use(express.json());
    app.use('/api/tasks', router);
    const { server, baseUrl } = await listen(app);
    try {
        const response = await fetch(`${baseUrl}/api/tasks/decompose-draft`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Request-ID': 'legacy-route-test',
                'X-Client-Version': 'task-create/v0.81.4'
            },
            body: JSON.stringify({
                mode: 'ai',
                title: 'private task title must not be logged',
                description: 'private task description must not be logged',
                impactIds: [101, 999_999],
                prompt: 'private prompt must not be logged',
                providerResponse: { text: 'private AI payload must not be logged' }
            })
        });
        const payload = await response.json();

        assert.equal(response.status, 200, JSON.stringify(payload));
        assert.equal(previewCalls, 1);
        assert.equal(decompositionCalls, 0);
        assert.equal(payload.success, true);
        assert.equal(payload.deprecated, true);
        assert.equal(payload.deprecatedEndpoint, '/api/tasks/ai-draft/preview');
        assert.equal(payload.source, 'ai_draft_preview');
        assert.equal(payload.proposal.title, 'Readable CRM handoff');
        assert.equal(payload.proposal.description, 'Prepare a readable CRM lead handoff with owner risks and next actions.');
        assert.deepEqual(payload.proposal.impactIds, [101]);
        assert.deepEqual(payload.subtasks.map(item => item.title), ['Check lead card', 'Write owner risks']);
        assert.equal(payload.proposalToken, 'token.signature');
        assert.deepEqual(capturedInput.impacts, activeImpacts);
        assert.deepEqual(capturedInput.draft.impactIds, [101, 999999]);

        assert.equal(telemetryEvents.length, 2);
        assert.deepEqual(telemetryEvents.map(event => event.type), ['deprecation', 'deprecation']);
        assert.deepEqual(telemetryEvents.map(event => event.reasonCode), [
            'legacy_decompose_wrapper_attempt',
            'legacy_decompose_wrapper_used'
        ]);
        for (const event of telemetryEvents) {
            assert.equal(event.route, '/api/tasks/decompose-draft');
            assert.equal(event.mode, 'ai');
            assert.equal(event.clientVersion, 'task-create/v0.81.4');
            assert.equal(event.requestId, 'legacy-route-test');
            assert.equal(event.canonicalTarget, '/api/tasks/ai-draft/preview');
            assert.equal(event.outcome, 'legacy_wrapper');
            assert.doesNotMatch(JSON.stringify(event), /private task|private prompt|private AI payload/i);
            for (const forbiddenKey of ['title', 'description', 'prompt', 'response', 'payload', 'draft']) {
                assert.equal(Object.hasOwn(event, forbiddenKey), false);
            }
        }
    } finally {
        await close(server);
        clearRouteModules();
    }
});

test('legacy decompose-draft template mode stays in taskDecomposition without canonical AI preview', async () => {
    clearRouteModules();
    let previewCalls = 0;
    let decompositionCalls = 0;
    let capturedContext = null;

    installBaseRouteMocks({
        taskDecomposition: {
            generateTaskDecompositionDraft: async context => {
                decompositionCalls += 1;
                capturedContext = context;
                return {
                    success: true,
                    mode: 'template',
                    templateKey: 'event_preparation',
                    source: 'template',
                    subtasks: [
                        { title: 'Confirm event format', source_type: 'template', sort_order: 0 },
                        { title: 'Prepare the room', source_type: 'template', sort_order: 1 }
                    ],
                    draftItems: [
                        { title: 'Confirm event format', source_type: 'template', sort_order: 0 },
                        { title: 'Prepare the room', source_type: 'template', sort_order: 1 }
                    ],
                    meta: { aiUsed: false, humanReviewRequired: true }
                };
            },
            getTaskDecompositionTemplates: () => [],
            normalizeDecompositionMode: (value, fallback = 'manual') => {
                const raw = String(value || '').trim();
                return ['none', 'manual', 'template', 'ai', 'template_ai'].includes(raw) ? raw : fallback;
            }
        },
        taskAiDraftPreview: {
            TASK_AI_DRAFT_SINGLE_COMMIT_AUDIENCE: 'task_ai_draft_commit',
            TASK_AI_DRAFT_BUNDLE_COMMIT_AUDIENCE: 'task_ai_draft_bundle_commit',
            generateTaskAiDraftPreview: async () => {
                previewCalls += 1;
                return { ok: false };
            },
            legacyDecompositionResponseFromPreview: () => ({ success: false })
        }
    });

    const router = require('../routes/tasks');
    const app = express();
    app.use(express.json());
    app.use('/api/tasks', router);
    const { server, baseUrl } = await listen(app);
    try {
        const response = await fetch(`${baseUrl}/api/tasks/decompose-draft`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                mode: 'template',
                title: 'Prepare event',
                description: 'Room and team checklist',
                templateKey: 'event_preparation',
                impactIds: [101]
            })
        });
        const payload = await response.json();

        assert.equal(response.status, 200, JSON.stringify(payload));
        assert.equal(previewCalls, 0);
        assert.equal(decompositionCalls, 1);
        assert.equal(payload.success, true);
        assert.equal(payload.source, 'template');
        assert.equal(payload.meta.aiUsed, false);
        assert.deepEqual(payload.subtasks.map(item => item.title), ['Confirm event format', 'Prepare the room']);
        assert.equal(capturedContext.title, 'Prepare event');
        assert.equal(capturedContext.description, 'Room and team checklist');
        assert.equal(capturedContext.mode, 'template');
        assert.equal(capturedContext.templateKey, 'event_preparation');
        assert.equal(Object.hasOwn(capturedContext, 'impactIds'), false);
    } finally {
        await close(server);
        clearRouteModules();
    }
});

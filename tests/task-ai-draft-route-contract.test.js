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

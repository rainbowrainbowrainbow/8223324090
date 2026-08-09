'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const { TASK_ACTION_TYPES } = require('../services/taskActionHistory');
const preview = require('../services/taskAiDraftPreview');
const commit = require('../services/taskAiDraftCommit');
const bundleCommit = require('../services/taskAiDraftBundleCommit');

const impacts = [
    { id: 101, name: 'Work: CRM', icon: '🗂️', isActive: true },
    { id: 104, name: 'Automation / AI', icon: '🤖', isActive: true }
];

const proposal = {
    action: 'apply',
    mode: 'checklist',
    title: 'Fix CRM booking form',
    description: 'Safe validation pass.',
    impactIds: [101, 104],
    subtasks: [
        { title: 'Reproduce invalid CRM booking submit' },
        { title: 'Patch booking validation' },
        { title: 'Verify CRM booking flow' }
    ],
    confidence: {
        overall: 0.9,
        title: 0.9,
        description: 0.86,
        impacts: 0.88,
        subtasks: 0.84,
        mode: 0.8
    },
    reason: 'Clear CRM checklist task.'
};

function makeToken(secret = 'proposal-secret') {
    const draft = { title: 'crm form', description: 'broken submit' };
    return {
        token: preview.createProposalToken({
            userId: 7,
            businessScope: { businessContext: 'event_genix' },
            fingerprint: preview.draftFingerprint(draft),
            proposal,
            catalogVersion: preview.activeImpactCatalogVersion(impacts),
            now: 1_000,
            secret
        }),
        draftFingerprint: preview.draftFingerprint(draft),
        proposalHash: preview.proposalHash(proposal)
    };
}

function createFakePool(options = {}) {
    const state = {
        calls: [],
        tasks: [],
        history: [],
        subtasks: [],
        impacts: [],
        pending: {
            tasks: [],
            history: [],
            subtasks: [],
            impacts: []
        },
        rolledBack: false,
        committed: false,
        nextTaskId: 501,
        failImpactWrite: options.failImpactWrite === true
    };
    const client = {
        async query(text, params = []) {
            const sql = String(text).replace(/\s+/g, ' ').trim();
            state.calls.push({ text: sql, params });
            if (sql === 'BEGIN') {
                state.pending = { tasks: [], history: [], subtasks: [], impacts: [] };
                return { rows: [] };
            }
            if (sql === 'COMMIT') {
                state.committed = true;
                state.tasks.push(...state.pending.tasks);
                state.history.push(...state.pending.history);
                state.subtasks.push(...state.pending.subtasks);
                state.impacts.push(...state.pending.impacts);
                state.pending = { tasks: [], history: [], subtasks: [], impacts: [] };
                return { rows: [] };
            }
            if (sql === 'ROLLBACK') {
                state.rolledBack = true;
                state.pending = { tasks: [], history: [], subtasks: [], impacts: [] };
                return { rows: [] };
            }
            if (/pg_advisory_xact_lock\(hashtext\(\$1\)::bigint\)/i.test(sql)) return { rows: [] };
            if (/FROM task_action_history h JOIN tasks t/i.test(sql)) {
                const existing = state.history.find(item => item.action_type === params[0] && item.meta_json?.idempotencyKey === params[2]);
                return { rows: existing ? [{ ...state.tasks.find(task => task.id === existing.task_id), ...existing }] : [] };
            }
            if (/FROM tasks WHERE id = ANY\(\$1::int\[\]\)/i.test(sql)) {
                const ids = params[0] || [];
                return {
                    rows: ids
                        .map(id => state.tasks.find(task => Number(task.id) === Number(id)))
                        .filter(Boolean)
                };
            }
            if (/INSERT INTO task_logs/i.test(sql)) return { rows: [] };
            if (/SELECT id FROM task_subtasks WHERE task_id = \$1/i.test(sql)) return { rows: [] };
            if (/DELETE FROM task_subtasks/i.test(sql)) return { rows: [] };
            if (/INSERT INTO task_subtasks/i.test(sql)) {
                const row = {
                    id: state.subtasks.length + 1,
                    task_id: params[0],
                    title: params[1],
                    is_done: params[2],
                    sort_order: params[3],
                    source_type: params[4]
                };
                state.pending.subtasks.push(row);
                return { rows: [row] };
            }
            if (/UPDATE tasks SET task_kind/i.test(sql)) return { rows: [] };
            if (/SELECT id, is_active FROM my_day_impacts/i.test(sql)) {
                if (state.failImpactWrite) throw new Error('forced impact write failure');
                const ids = params[1] || [];
                return { rows: ids.map(id => ({ id, is_active: true })) };
            }
            if (/INSERT INTO my_day_task_metadata/i.test(sql)) return { rows: [] };
            if (/DELETE FROM my_day_task_impacts/i.test(sql)) return { rows: [] };
            if (/INSERT INTO my_day_task_impacts/i.test(sql)) {
                state.pending.impacts.push(...(params[2] || []).map(impactId => ({ user_id: params[0], task_id: params[1], impact_id: impactId })));
                return { rows: [] };
            }
            if (/FROM \(SELECT \$1::bigint AS user_id, \$2::bigint AS task_id\) base/i.test(sql)) {
                const allImpacts = [...state.impacts, ...state.pending.impacts];
                return {
                    rows: [{
                        direction_id: null,
                        impacts: allImpacts.map(item => ({
                            id: item.impact_id,
                            name: item.impact_id === 101 ? 'Work: CRM' : 'Automation / AI',
                            color: '#2563EB',
                            icon: 'x',
                            isActive: true
                        }))
                    }]
                };
            }
            if (/INSERT INTO task_action_history/i.test(sql)) {
                const row = {
                    id: state.history.length + 1,
                    task_id: params[0],
                    action_type: params[1],
                    actor_user_id: params[2],
                    actor_name_snapshot: params[3],
                    source_surface: params[4],
                    old_value_json: params[5] ? JSON.parse(params[5]) : null,
                    new_value_json: params[6] ? JSON.parse(params[6]) : null,
                    meta_json: params[7] ? JSON.parse(params[7]) : null,
                    summary: params[8],
                    created_at: '2026-08-09T12:00:00.000Z'
                };
                state.pending.history.push(row);
                return { rows: [row] };
            }
            throw new Error(`Unexpected SQL: ${sql}`);
        },
        release() {
            state.released = true;
        }
    };
    return {
        state,
        async connect() {
            return client;
        }
    };
}

function fakeCreateTaskImpl(fakePool) {
    return async data => {
        const row = {
            id: fakePool.state.nextTaskId++,
            business_context: data.businessContext,
            title: data.title,
            description: data.description,
            date: data.date,
            deadline: data.deadline,
            priority: data.priority,
            owner_user_id: data.owner_user_id,
            assigned_to: data.assigned_to,
            created_by_user_id: data.created_by_user_id,
            task_mode: data.task_mode,
            task_kind: data.task_kind,
            visibility: data.visibility,
            workflow_state: data.workflow_state,
            dependency_ids: data.dependency_ids || [],
            source_type: data.source_type,
            source_id: data.source_id,
            source_module: data.source_module,
            control_meta: data.control_meta
        };
        fakePool.state.pending.tasks.push(row);
        return row;
    };
}

function commitInput(tokenParts, overrides = {}) {
    return {
        proposalToken: tokenParts.token,
        proposalHash: tokenParts.proposalHash,
        draftFingerprint: tokenParts.draftFingerprint,
        finalDraft: {
            title: 'Fix CRM booking form',
            description: 'Make validation safe.',
            mode: 'checklist',
            taskMode: 'work',
            impactIds: [101, 104],
            subtasks: proposal.subtasks
        },
        acceptedFieldMask: ['title', 'description', 'mode', 'impactIds', 'subtasks'],
        idempotencyKey: 'ai-commit-key-1',
        activeImpacts: impacts,
        userId: 7,
        user: { id: 7, username: 'tester', name: 'Tester' },
        businessScope: { businessContext: 'event_genix' },
        ...overrides
    };
}

test('AI draft commit creates task, subtasks, impacts, and AI history in one transaction without sensitive history text', async () => {
    const tokenParts = makeToken();
    const fakePool = createFakePool();
    const telemetryEvents = [];
    const result = await commit.commitTaskAiDraft(commitInput(tokenParts), {
        pool: fakePool,
        proposalSecret: 'proposal-secret',
        now: 2_000,
        createTaskImpl: fakeCreateTaskImpl(fakePool),
        telemetry: {
            logger: {
                info: (message, data) => telemetryEvents.push({ message, data })
            }
        }
    });

    assert.equal(result.ok, true);
    assert.equal(result.replayed, false);
    assert.equal(result.task.id, 501);
    assert.equal(result.subtasks.length, 3);
    assert.equal(result.classification.impacts.length, 2);
    assert.equal(result.historyEvent.actionType, TASK_ACTION_TYPES.AI_DRAFT_COMMITTED);
    assert.equal(fakePool.state.committed, true);
    assert.equal(fakePool.state.rolledBack, false);
    assert.equal(fakePool.state.tasks.length, 1);
    assert.ok(String(fakePool.state.tasks[0].source_id || '').length <= 50);
    assert.ok(String(fakePool.state.tasks[0].assigned_to || '').length <= 50);
    assert.equal(fakePool.state.impacts.length, 2);
    assert.equal(fakePool.state.history.length, 1);
    assert.ok(fakePool.state.calls.some(call => /pg_advisory_xact_lock/i.test(call.text)));

    const history = fakePool.state.history[0];
    assert.equal(history.meta_json.idempotencyKey, 'ai-commit-key-1');
    assert.equal(history.meta_json.provider, 'openai');
    assert.equal(history.meta_json.model, 'gpt-5.6-luna');
    assert.equal(history.meta_json.rawPromptStored, false);
    assert.equal(history.meta_json.rawProviderResponseStored, false);
    assert.equal(history.new_value_json.impactCount, 2);
    assert.equal(JSON.stringify(history).includes('Make validation safe'), false);
    assert.equal(JSON.stringify(history).includes('Fix CRM booking form'), false);
    assert.equal(telemetryEvents.length, 1);
    assert.equal(telemetryEvents[0].data.type, 'commit');
    assert.equal(telemetryEvents[0].data.status, 'success');
    assert.deepEqual(telemetryEvents[0].data.acceptedFieldMask, ['title', 'description', 'mode', 'impactIds', 'subtasks']);
    assert.deepEqual(telemetryEvents[0].data.changedFields, ['title', 'description', 'mode', 'impactIds', 'subtasks']);
    assert.equal(JSON.stringify(telemetryEvents[0].data).includes('Fix CRM booking form'), false);
});

test('AI draft commit compacts legacy task text references to database-safe length', () => {
    const longValue = 'x'.repeat(120);
    assert.equal(commit.legacyTaskTextRef(longValue).length, 50);
    assert.equal(commit.legacyTaskTextRef('', 'ai-draft'), 'ai-draft');
});

test('AI draft commit rolls back completely when impact write fails', async () => {
    const tokenParts = makeToken();
    const fakePool = createFakePool({ failImpactWrite: true });
    await assert.rejects(
        () => commit.commitTaskAiDraft(commitInput(tokenParts), {
            pool: fakePool,
            proposalSecret: 'proposal-secret',
            now: 2_000,
            createTaskImpl: fakeCreateTaskImpl(fakePool)
        }),
        /forced impact write failure/
    );

    assert.equal(fakePool.state.rolledBack, true);
    assert.equal(fakePool.state.committed, false);
    assert.equal(fakePool.state.history.length, 0);
});

test('AI draft commit returns existing result for idempotent replay and rejects conflicting replay body', async () => {
    const tokenParts = makeToken();
    const fakePool = createFakePool();
    const first = await commit.commitTaskAiDraft(commitInput(tokenParts), {
        pool: fakePool,
        proposalSecret: 'proposal-secret',
        now: 2_000,
        createTaskImpl: fakeCreateTaskImpl(fakePool)
    });
    const replay = await commit.commitTaskAiDraft(commitInput(tokenParts), {
        pool: fakePool,
        proposalSecret: 'proposal-secret',
        now: 2_000,
        createTaskImpl: fakeCreateTaskImpl(fakePool)
    });
    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    assert.equal(fakePool.state.tasks.length, 1);
    assert.equal(fakePool.state.history.length, 1);

    await assert.rejects(
        () => commit.commitTaskAiDraft(commitInput(tokenParts, {
            finalDraft: {
                title: 'Different title',
                description: 'Different',
                mode: 'simple',
                impactIds: [101],
                subtasks: []
            }
        }), {
            pool: fakePool,
            proposalSecret: 'proposal-secret',
            now: 2_000,
            createTaskImpl: fakeCreateTaskImpl(fakePool)
        }),
        error => error.code === 'TASK_AI_DRAFT_IDEMPOTENCY_CONFLICT'
    );
});

test('AI draft commit validates token TTL, proposal hash, draft fingerprint, and catalog version before writes', async () => {
    const tokenParts = makeToken();
    const fakePool = createFakePool();

    await assert.rejects(
        () => commit.commitTaskAiDraft(commitInput(tokenParts, { proposalHash: 'bad' }), {
            pool: fakePool,
            proposalSecret: 'proposal-secret',
            now: 2_000
        }),
        error => error.code === 'TASK_AI_DRAFT_PROPOSAL_CONFLICT'
    );
    await assert.rejects(
        () => commit.commitTaskAiDraft(commitInput(tokenParts, { draftFingerprint: 'bad' }), {
            pool: fakePool,
            proposalSecret: 'proposal-secret',
            now: 2_000
        }),
        error => error.code === 'TASK_AI_DRAFT_FINGERPRINT_CONFLICT'
    );
    await assert.rejects(
        () => commit.commitTaskAiDraft(commitInput(tokenParts, { activeImpacts: [{ id: 101, name: 'Work: CRM', isActive: true }] }), {
            pool: fakePool,
            proposalSecret: 'proposal-secret',
            now: 2_000
        }),
        error => error.code === 'TASK_AI_DRAFT_CATALOG_CHANGED'
    );
    await assert.rejects(
        () => commit.commitTaskAiDraft(commitInput(tokenParts), {
            pool: fakePool,
            proposalSecret: 'proposal-secret',
            now: 999_999_999
        }),
        error => error.code === 'TASK_AI_DRAFT_TOKEN_EXPIRED'
    );
    assert.equal(fakePool.state.tasks.length, 0);
});

test('task AI draft commit route is explicit, atomic, idempotent, and emits side effects only after commit', () => {
    const route = fs.readFileSync(path.join(root, 'routes', 'tasks.js'), 'utf8');
    const service = fs.readFileSync(path.join(root, 'services', 'taskAiDraftCommit.js'), 'utf8');
    const kleshnya = fs.readFileSync(path.join(root, 'services', 'kleshnya.js'), 'utf8');
    const routeBlock = route.slice(route.indexOf("router.post('/ai-draft/commit'"), route.indexOf("router.post('/decompose-draft'"));
    const historyStart = service.indexOf('const historyEvent = await logTaskActionEvent');
    const historyBlock = service.slice(historyStart, service.indexOf("}, { pool: client });", historyStart));

    assert.match(routeBlock, /buildTaskAiDraftCommit/);
    assert.match(routeBlock, /if \(!result\.replayed\)/);
    assert.ok(routeBlock.indexOf('const result = await buildTaskAiDraftCommit') < routeBlock.indexOf('emitTaskAssignedToOwner'));
    assert.ok(routeBlock.indexOf('const result = await buildTaskAiDraftCommit') < routeBlock.indexOf('notifyTaskAssignment'));
    assert.match(routeBlock, /notificationTiming: 'after_commit'/);
    assert.match(service, /SELECT pg_advisory_xact_lock\(hashtext\(\$1\)::bigint\)/);
    assert.match(service, /BEGIN/);
    assert.match(service, /COMMIT/);
    assert.match(service, /ROLLBACK/);
    assert.match(service, /findCommittedReplay/);
    assert.match(service, /skipNotifications: true/);
    assert.match(service, /skipHermesOutbox: true/);
    assert.match(service, /replaceTaskSubtasks\(client/);
    assert.match(service, /replaceTaskClassification\(client/);
    assert.match(service, /TASK_ACTION_TYPES\.AI_DRAFT_COMMITTED/);
    assert.doesNotMatch(service, /dependency_ids:\s*finalDraft|directionId|rawProviderResponse:\s*|prompt:\s*finalDraft/);
    assert.doesNotMatch(historyBlock, /title|description|tags|directionId|rawProviderResponse:\s*|prompt:\s*/i);
    assert.match(kleshnya, /skipNotifications = options\.skipNotifications === true/);
    assert.match(kleshnya, /skipHermesOutbox = options\.skipHermesOutbox === true/);
});

const bundleProposal = {
    decision: 'task_bundle',
    mode: null,
    title: null,
    description: null,
    impactIds: [],
    subtasks: [],
    bundleTitle: 'CRM + automation bundle',
    tasks: [
        {
            title: 'Audit CRM booking form',
            description: 'Find broken validation path.',
            impactIds: [101],
            priority: 'high',
            dueDate: '2026-08-10',
            ownerSuggestion: { userId: null, name: 'Tester', reason: 'Current user should review.' },
            confidence: proposal.confidence
        },
        {
            title: 'Patch AI automation trigger',
            description: 'Make worker safe.',
            impactIds: [104],
            priority: 'normal',
            dueDate: null,
            ownerSuggestion: { userId: null, name: 'Tester', reason: 'Current user should review.' },
            confidence: proposal.confidence
        }
    ],
    confidence: proposal.confidence,
    reason: 'Needs two real tasks.'
};

function makeBundleToken(secret = 'proposal-secret') {
    const draft = { title: 'crm automation plan', description: 'split safely' };
    return {
        token: preview.createProposalToken({
            userId: 7,
            businessScope: { businessContext: 'event_genix' },
            fingerprint: preview.draftFingerprint(draft),
            proposal: bundleProposal,
            catalogVersion: preview.activeImpactCatalogVersion(impacts),
            now: 1_000,
            secret
        }),
        draftFingerprint: preview.draftFingerprint(draft),
        proposalHash: preview.proposalHash(bundleProposal)
    };
}

function bundleCommitInput(tokenParts, overrides = {}) {
    return {
        proposalToken: tokenParts.token,
        proposalHash: tokenParts.proposalHash,
        draftFingerprint: tokenParts.draftFingerprint,
        proposal: bundleProposal,
        bundleTitle: bundleProposal.bundleTitle,
        tasks: bundleProposal.tasks.map(task => ({
            title: task.title,
            description: task.description,
            impactIds: task.impactIds,
            priority: task.priority,
            dueDate: task.dueDate,
            ownerSuggestion: task.ownerSuggestion
        })),
        acceptedTaskMask: [0, 1],
        rejectedTaskMask: [],
        idempotencyKey: 'ai-bundle-key-1',
        activeImpacts: impacts,
        userId: 7,
        user: { id: 7, username: 'tester', name: 'Tester' },
        businessScope: { businessContext: 'event_genix' },
        ...overrides
    };
}

test('AI draft bundle commit creates all tasks, impacts, and bundle audit in one transaction', async () => {
    const tokenParts = makeBundleToken();
    const fakePool = createFakePool();
    const result = await bundleCommit.commitTaskAiDraftBundle(bundleCommitInput(tokenParts), {
        pool: fakePool,
        proposalSecret: 'proposal-secret',
        now: 2_000,
        createTaskImpl: fakeCreateTaskImpl(fakePool)
    });

    assert.equal(result.ok, true);
    assert.equal(result.replayed, false);
    assert.equal(result.bundle.taskCount, 2);
    assert.deepEqual(result.bundle.taskIds, [501, 502]);
    assert.equal(fakePool.state.committed, true);
    assert.equal(fakePool.state.rolledBack, false);
    assert.equal(fakePool.state.tasks.length, 2);
    assert.equal(fakePool.state.impacts.length, 2);
    assert.equal(fakePool.state.history.length, 3);
    assert.ok(fakePool.state.calls.some(call => /pg_advisory_xact_lock/i.test(call.text)));
    assert.equal(fakePool.state.tasks[0].source_type, 'ai_draft_bundle');
    assert.deepEqual(fakePool.state.tasks[0].dependency_ids, []);

    const bundleHistory = fakePool.state.history.find(item => item.action_type === TASK_ACTION_TYPES.AI_DRAFT_BUNDLE_COMMITTED);
    assert.ok(bundleHistory);
    assert.deepEqual(bundleHistory.meta_json.taskIds, [501, 502]);
    assert.equal(bundleHistory.meta_json.rawPromptStored, false);
    assert.equal(bundleHistory.meta_json.rawProviderResponseStored, false);
    assert.equal(JSON.stringify(bundleHistory).includes('Find broken validation path'), false);
    assert.equal(JSON.stringify(bundleHistory).includes('Patch AI automation trigger'), false);
});

test('AI draft bundle commit rolls back every task when any write fails', async () => {
    const tokenParts = makeBundleToken();
    const fakePool = createFakePool({ failImpactWrite: true });
    await assert.rejects(
        () => bundleCommit.commitTaskAiDraftBundle(bundleCommitInput(tokenParts), {
            pool: fakePool,
            proposalSecret: 'proposal-secret',
            now: 2_000,
            createTaskImpl: fakeCreateTaskImpl(fakePool)
        }),
        /forced impact write failure/
    );

    assert.equal(fakePool.state.rolledBack, true);
    assert.equal(fakePool.state.committed, false);
    assert.equal(fakePool.state.tasks.length, 0);
    assert.equal(fakePool.state.impacts.length, 0);
    assert.equal(fakePool.state.history.length, 0);
});

test('AI draft bundle commit is idempotent and rejects conflicting replay body', async () => {
    const tokenParts = makeBundleToken();
    const fakePool = createFakePool();
    const input = bundleCommitInput(tokenParts);
    const first = await bundleCommit.commitTaskAiDraftBundle(input, {
        pool: fakePool,
        proposalSecret: 'proposal-secret',
        now: 2_000,
        createTaskImpl: fakeCreateTaskImpl(fakePool)
    });
    const replay = await bundleCommit.commitTaskAiDraftBundle(input, {
        pool: fakePool,
        proposalSecret: 'proposal-secret',
        now: 2_000,
        createTaskImpl: fakeCreateTaskImpl(fakePool)
    });

    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    assert.equal(fakePool.state.tasks.length, 2);
    assert.deepEqual(replay.bundle.taskIds, [501, 502]);

    await assert.rejects(
        () => bundleCommit.commitTaskAiDraftBundle(bundleCommitInput(tokenParts, {
            tasks: [
                ...input.tasks.slice(0, 1),
                { ...input.tasks[1], title: 'Different bundle task' }
            ]
        }), {
            pool: fakePool,
            proposalSecret: 'proposal-secret',
            now: 2_000,
            createTaskImpl: fakeCreateTaskImpl(fakePool)
        }),
        error => error.code === 'TASK_AI_DRAFT_IDEMPOTENCY_CONFLICT'
    );
});

test('AI draft bundle commit rejects unknown and archived impacts before opening a transaction', async () => {
    const tokenParts = makeBundleToken();
    const fakePool = createFakePool();
    await assert.rejects(
        () => bundleCommit.commitTaskAiDraftBundle(bundleCommitInput(tokenParts, {
            tasks: [
                ...bundleCommitInput(tokenParts).tasks.slice(0, 1),
                { ...bundleCommitInput(tokenParts).tasks[1], impactIds: [999_999] }
            ]
        }), {
            pool: fakePool,
            proposalSecret: 'proposal-secret',
            now: 2_000,
            createTaskImpl: fakeCreateTaskImpl(fakePool)
        }),
        error => error.code === 'TASK_AI_BUNDLE_UNKNOWN_IMPACT'
    );
    assert.equal(fakePool.state.calls.length, 0);

    await assert.rejects(
        () => bundleCommit.commitTaskAiDraftBundle(bundleCommitInput(tokenParts, {
            activeImpacts: [
                { id: 101, name: 'Work: CRM', isActive: true },
                { id: 104, name: 'Automation / AI', isActive: false }
            ]
        }), {
            pool: fakePool,
            proposalSecret: 'proposal-secret',
            now: 2_000,
            createTaskImpl: fakeCreateTaskImpl(fakePool)
        }),
        error => error.code === 'TASK_AI_BUNDLE_UNKNOWN_IMPACT'
    );
});

test('AI draft bundle commit rejects invalid task count, owner, date, and priority before writes', async () => {
    const tokenParts = makeBundleToken();
    const fakePool = createFakePool();
    const base = bundleCommitInput(tokenParts);

    await assert.rejects(
        () => bundleCommit.commitTaskAiDraftBundle({ ...base, tasks: base.tasks.slice(0, 1) }, {
            pool: fakePool,
            proposalSecret: 'proposal-secret',
            now: 2_000,
            createTaskImpl: fakeCreateTaskImpl(fakePool)
        }),
        error => error.code === 'TASK_AI_BUNDLE_TOO_SMALL'
    );
    await assert.rejects(
        () => bundleCommit.commitTaskAiDraftBundle({ ...base, tasks: Array.from({ length: 7 }, (_, index) => ({ ...base.tasks[index % 2], title: `Task ${index}` })) }, {
            pool: fakePool,
            proposalSecret: 'proposal-secret',
            now: 2_000,
            createTaskImpl: fakeCreateTaskImpl(fakePool)
        }),
        error => error.code === 'TASK_AI_BUNDLE_TOO_LARGE'
    );
    await assert.rejects(
        () => bundleCommit.commitTaskAiDraftBundle({ ...base, tasks: [{ ...base.tasks[0], priority: 'critical' }, base.tasks[1]] }, {
            pool: fakePool,
            proposalSecret: 'proposal-secret',
            now: 2_000,
            createTaskImpl: fakeCreateTaskImpl(fakePool)
        }),
        error => error.code === 'TASK_AI_BUNDLE_PRIORITY_INVALID'
    );
    await assert.rejects(
        () => bundleCommit.commitTaskAiDraftBundle({ ...base, tasks: [{ ...base.tasks[0], dueDate: 'tomorrow' }, base.tasks[1]] }, {
            pool: fakePool,
            proposalSecret: 'proposal-secret',
            now: 2_000,
            createTaskImpl: fakeCreateTaskImpl(fakePool)
        }),
        error => error.code === 'TASK_AI_BUNDLE_DUE_DATE_INVALID'
    );
    await assert.rejects(
        () => bundleCommit.commitTaskAiDraftBundle({ ...base, tasks: [{ ...base.tasks[0], ownerSuggestion: { userId: 999, name: 'Other', reason: 'Unsafe' } }, base.tasks[1]] }, {
            pool: fakePool,
            proposalSecret: 'proposal-secret',
            now: 2_000,
            createTaskImpl: fakeCreateTaskImpl(fakePool)
        }),
        error => error.code === 'TASK_AI_BUNDLE_OWNER_INVALID'
    );
    assert.equal(fakePool.state.tasks.length, 0);
    assert.equal(fakePool.state.calls.length, 0);
});

test('AI draft bundle commit rejects token tamper and expired token before writes', async () => {
    const tokenParts = makeBundleToken();
    const fakePool = createFakePool();
    await assert.rejects(
        () => bundleCommit.commitTaskAiDraftBundle(bundleCommitInput({ ...tokenParts, token: `${tokenParts.token}x` }), {
            pool: fakePool,
            proposalSecret: 'proposal-secret',
            now: 2_000,
            createTaskImpl: fakeCreateTaskImpl(fakePool)
        }),
        error => error.code === 'TASK_AI_DRAFT_TOKEN_INVALID'
    );
    await assert.rejects(
        () => bundleCommit.commitTaskAiDraftBundle(bundleCommitInput(tokenParts), {
            pool: fakePool,
            proposalSecret: 'proposal-secret',
            now: 999_999_999,
            createTaskImpl: fakeCreateTaskImpl(fakePool)
        }),
        error => error.code === 'TASK_AI_DRAFT_TOKEN_EXPIRED'
    );
    assert.equal(fakePool.state.tasks.length, 0);
});

test('task AI draft bundle route uses atomic endpoint and side effects after commit only', () => {
    const route = fs.readFileSync(path.join(root, 'routes', 'tasks.js'), 'utf8');
    const service = fs.readFileSync(path.join(root, 'services', 'taskAiDraftBundleCommit.js'), 'utf8');
    const routeBlock = route.slice(route.indexOf("router.post('/ai-draft/bundle/commit'"), route.indexOf("router.post('/decompose-draft'"));
    const historyStart = service.indexOf('const historyEvent = await logTaskActionEvent');
    const historyBlock = service.slice(historyStart, service.indexOf("}, { pool: client });", historyStart));

    assert.match(routeBlock, /buildTaskAiDraftBundleCommit/);
    assert.match(routeBlock, /if \(!result\.replayed\)/);
    assert.ok(routeBlock.indexOf('const result = await buildTaskAiDraftBundleCommit') < routeBlock.indexOf('emitTaskAssignedToOwner'));
    assert.ok(routeBlock.indexOf('const result = await buildTaskAiDraftBundleCommit') < routeBlock.indexOf('notifyTaskAssignment'));
    assert.match(routeBlock, /notificationTiming: 'after_commit'/);
    assert.match(service, /SELECT pg_advisory_xact_lock\(hashtext\(\$1\)::bigint\)/);
    assert.match(service, /BEGIN/);
    assert.match(service, /COMMIT/);
    assert.match(service, /ROLLBACK/);
    assert.match(service, /findBundleReplay/);
    assert.match(service, /skipNotifications: true/);
    assert.match(service, /skipHermesOutbox: true/);
    assert.match(service, /replaceTaskClassification\(client/);
    assert.match(service, /TASK_ACTION_TYPES\.AI_DRAFT_BUNDLE_COMMITTED/);
    assert.doesNotMatch(service, /dependencies|directionId|tags|rawProviderResponse:\s*|prompt:\s*/i);
    assert.doesNotMatch(historyBlock, /title|description|tags|directionId|rawProviderResponse:\s*|prompt:\s*/i);
});

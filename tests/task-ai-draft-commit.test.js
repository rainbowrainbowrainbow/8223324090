'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const { TASK_ACTION_TYPES } = require('../services/taskActionHistory');
const preview = require('../services/taskAiDraftPreview');
const commit = require('../services/taskAiDraftCommit');

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
                const existing = state.history.find(item => item.meta_json?.idempotencyKey === params[2]);
                return { rows: existing ? [{ ...state.tasks.find(task => task.id === existing.task_id), ...existing }] : [] };
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
            owner_user_id: data.owner_user_id,
            assigned_to: data.assigned_to,
            created_by_user_id: data.created_by_user_id,
            task_mode: data.task_mode,
            task_kind: data.task_kind,
            visibility: data.visibility,
            workflow_state: data.workflow_state,
            source_type: data.source_type,
            source_id: data.source_id
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

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const {
    privateTaskHandoffNeedsConfirmation
} = require('../services/taskPolicy');
const {
    reassignTaskOwner
} = require('../services/taskExecution');

function handoffTask(overrides = {}) {
    return {
        id: 901,
        title: 'Private handoff test',
        owner_user_id: 7,
        assigned_to: 'Current owner',
        owner: 'Current owner',
        visibility: 'private',
        version: 3,
        business_context: 'event_genix',
        status: 'todo',
        ...overrides
    };
}

function createReassignPool(options = {}) {
    const task = handoffTask(options.task);
    const calls = [];
    const pool = {
        calls,
        async query(sql, params = []) {
            const compact = String(sql).replace(/\s+/g, ' ').trim();
            calls.push({ compact, params });
            if (compact.startsWith('SELECT t.*, u.name AS owner_name')) {
                return { rows: [task] };
            }
            if (compact.startsWith('SELECT id, username, name, role FROM users')) {
                return { rows: [{ id: 8, username: 'receiver', name: 'Receiver', role: 'manager' }] };
            }
            if (compact.startsWith('SELECT 1 FROM task_observers')) {
                return { rows: options.actorIsObserver ? [{ present: 1 }] : [] };
            }
            if (compact.startsWith('UPDATE tasks')) {
                task.owner_user_id = 8;
                task.assigned_to = 'Receiver';
                task.version += 1;
                return { rows: [task] };
            }
            if (compact.startsWith('INSERT INTO task_action_history')) {
                return {
                    rows: [{
                        id: 1,
                        task_id: task.id,
                        action_type: 'task_owner_reassigned',
                        actor_user_id: 7,
                        actor_name_snapshot: 'Current owner'
                    }]
                };
            }
            throw new Error(`Unexpected task handoff query: ${compact}`);
        }
    };
    return pool;
}

const creator = { id: 7, username: 'current-owner', name: 'Current owner', role: 'creator' };

test('private handoff policy requires confirmation only when the actor will lose access', () => {
    const task = handoffTask();
    assert.equal(privateTaskHandoffNeedsConfirmation(task, creator, 8, false), true);
    assert.equal(privateTaskHandoffNeedsConfirmation(task, creator, 7, false), false);
    assert.equal(privateTaskHandoffNeedsConfirmation(task, creator, 8, true), false);
    assert.equal(privateTaskHandoffNeedsConfirmation({ ...task, visibility: 'team' }, creator, 8, false), false);
    assert.equal(privateTaskHandoffNeedsConfirmation({ ...task, visibility: 'me_only' }, creator, 8, false), true);
});

test('reassign blocks private handoff before UPDATE and preserves visibility after explicit confirmation', async () => {
    const pool = createReassignPool();
    await assert.rejects(
        () => reassignTaskOwner(901, 8, creator, { pool }),
        error => {
            assert.equal(error.statusCode, 409);
            assert.equal(error.code, 'TASK_PRIVATE_HANDOFF_CONFIRM_REQUIRED');
            assert.deepEqual(error.meta, {
                privateHandoff: {
                    confirmationRequired: true,
                    actorWillLoseAccess: true,
                    visibility: 'private',
                    nextOwner: { id: 8, label: 'Receiver' }
                }
            });
            return true;
        }
    );
    assert.equal(pool.calls.some(call => call.compact.startsWith('UPDATE tasks')), false);
    assert.equal(pool.calls.some(call => call.compact.includes('INSERT INTO task_observers')), false);

    const result = await reassignTaskOwner(901, 8, creator, {
        pool,
        confirmPrivateHandoff: true
    });
    assert.equal(result.task.owner_user_id, 8);
    assert.equal(result.task.visibility, 'private');
    const update = pool.calls.find(call => call.compact.startsWith('UPDATE tasks'));
    assert.ok(update);
    assert.doesNotMatch(update.compact, /\bvisibility\s*=/i);
    assert.equal(pool.calls.some(call => call.compact.includes('INSERT INTO task_observers')), false);
});

test('pre-existing observer access does not require private handoff confirmation', async () => {
    const pool = createReassignPool({ actorIsObserver: true });
    const result = await reassignTaskOwner(901, 8, creator, { pool });
    assert.equal(result.task.owner_user_id, 8);
    assert.equal(pool.calls.some(call => call.compact.startsWith('UPDATE tasks')), true);
});

test('shared UI helper confirms only after the canonical 409 and retries with true', async () => {
    const sandbox = { window: null };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'task-ui-shared.js'), 'utf8'), sandbox);

    const attempts = [];
    let confirmation = null;
    const result = await sandbox.TaskUiShared.executePrivateTaskHandoff(async confirmed => {
        attempts.push(confirmed);
        if (!confirmed) {
            return {
                success: false,
                code: 'TASK_PRIVATE_HANDOFF_CONFIRM_REQUIRED',
                meta: {
                    privateHandoff: {
                        confirmationRequired: true,
                        actorWillLoseAccess: true,
                        visibility: 'private',
                        nextOwner: { id: 8, label: 'Receiver' }
                    }
                }
            };
        }
        return { success: true };
    }, {
        confirm: async (message, options) => {
            confirmation = { message, options };
            return true;
        }
    });

    assert.deepEqual(attempts, [false, true]);
    assert.equal(result.success, true);
    assert.match(confirmation.message, /Receiver/);
    assert.equal(confirmation.options.okText, 'Передати і втратити доступ');
});

test('all reassignment routes use the same private handoff contract', () => {
    const tasksRoute = fs.readFileSync(path.join(ROOT, 'routes', 'tasks.js'), 'utf8');
    const hermesRoute = fs.readFileSync(path.join(ROOT, 'routes', 'hermes.js'), 'utf8');
    const taskCenter = fs.readFileSync(path.join(ROOT, 'js', 'tasks-page.js'), 'utf8');
    const myDay = fs.readFileSync(path.join(ROOT, 'js', 'profile-page.js'), 'utf8');

    assert.match(tasksRoute, /confirmPrivateHandoff: req\.body\?\.confirmPrivateHandoff === true/);
    assert.match(tasksRoute, /assertPrivateTaskHandoffConfirmed\(old, typedOwner\.owner, req\.user/);
    assert.match(tasksRoute, /TASK_REASSIGN_USE_CANONICAL_ENDPOINT/);
    assert.match(hermesRoute, /confirmPrivateHandoff: payload\.confirmPrivateHandoff === true/);
    assert.match(hermesRoute, /sendHermesError\(res, err\.statusCode, err\.code \|\| 'HERMES_TASK_MUTATION_FAILED', err\.message, err\.meta \|\| null\)/);
    assert.match(taskCenter, /executePrivateTaskHandoff/);
    assert.match(taskCenter, /confirmPrivateHandoff: confirmed === true/);
    assert.match(myDay, /executePrivateTaskHandoff/);
    assert.match(myDay, /if \(confirmed === true\) payload\.confirmPrivateHandoff = true/);
});

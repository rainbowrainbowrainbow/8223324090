const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const {
    canUseTaskRouteCapability,
    taskRouteCapabilityDecision
} = require('../services/taskPolicy');
const { taskDrawerActionContract } = require('../services/taskDetailContract');

test('legacy task-route capabilities are exposed without granting extra access', () => {
    const instructor = { id: 12, role: 'instructor' };
    const manager = { id: 13, role: 'manager' };

    assert.equal(canUseTaskRouteCapability(instructor, 'create'), true);
    assert.equal(canUseTaskRouteCapability(instructor, 'delete'), false);
    assert.equal(taskRouteCapabilityDecision(instructor, 'delete').reasonCode, 'TASK_DELETE_FORBIDDEN');
    assert.equal(canUseTaskRouteCapability(manager, 'review'), true);
    assert.equal(taskRouteCapabilityDecision(manager, 'review').allowed, true);
});

test('drawer permits reassign when its existing route policy permits it even without edit', () => {
    const actor = { id: 20, role: 'manager' };
    const task = {
        id: 401,
        status: 'todo',
        visibility: 'private',
        owner_user_id: 99,
        viewer_is_observer: true
    };

    const contract = taskDrawerActionContract(task, actor);
    assert.equal(contract.actions.edit, false);
    assert.equal(contract.actions.reassign, true);
    assert.equal(contract.reasons.reassign, null);
    assert.equal(contract.reasons.edit, 'TASK_MUTATION_FORBIDDEN');
});

test('drawer returns server-derived review and delete denial reasons', () => {
    const actor = { id: 31, role: 'instructor' };
    const task = { id: 402, status: 'done', visibility: 'team', owner_user_id: 31 };
    const contract = taskDrawerActionContract(task, actor);

    assert.equal(contract.actions.review, false);
    assert.equal(contract.reasons.review, 'TASK_REVIEW_FORBIDDEN');
    assert.equal(contract.actions.delete, false);
    assert.equal(contract.reasons.delete, 'TASK_DELETE_FORBIDDEN');
});

test('bulk route checks each visible target for mutation authority before any update', () => {
    const route = fs.readFileSync(path.join(ROOT, 'routes', 'tasks.js'), 'utf8');
    const bulkStart = route.indexOf("router.post('/bulk'");
    const bulk = route.slice(bulkStart);
    const targetLoad = bulk.indexOf('const targetResult = await pool.query');
    const mutationCheck = bulk.indexOf('const mutationForbidden = targetResult.rows.filter');
    const rejection = bulk.indexOf("code: 'TASK_BULK_MUTATION_FORBIDDEN'");
    const firstUpdate = bulk.indexOf('UPDATE tasks t');

    assert.ok(bulkStart >= 0);
    assert.ok(targetLoad >= 0 && targetLoad < mutationCheck);
    assert.ok(mutationCheck >= 0 && mutationCheck < rejection);
    assert.ok(rejection >= 0 && rejection < firstUpdate);
    assert.match(bulk, /canMutateTask\(req\.user, task\)/);
    assert.match(bulk, /TASK_BULK_REASSIGN_FORBIDDEN/);
});

test('Task Center consumes capability decisions and explains disabled drawer actions', () => {
    const page = fs.readFileSync(path.join(ROOT, 'js', 'tasks-page.js'), 'utf8');

    assert.match(page, /taskCapabilities = permsResult\.capabilities \|\| \{\}/);
    assert.match(page, /taskCapabilityAllowed\('create'/);
    assert.match(page, /taskCapabilityDecision\('delete'/);
    assert.match(page, /taskPermissionReasonLabel\(reasons\[action\]\)/);
    assert.match(page, /data-task-drawer-action="review"/);
    assert.match(page, /data-task-drawer-action="delete"/);
});

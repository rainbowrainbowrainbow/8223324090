const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const {
    canUseTaskRouteCapability,
    taskRouteCapabilityDecision
} = require('../services/taskPolicy');
const registry = require('../config/permissionRegistry');
const { taskDrawerActionContract } = require('../services/taskDetailContract');

test('canonical task-route capabilities are exposed without granting extra access', () => {
    const instructor = { id: 12, role: 'instructor' };
    const manager = { id: 13, role: 'manager' };

    assert.equal(canUseTaskRouteCapability(instructor, 'create'), true);
    assert.equal(canUseTaskRouteCapability(instructor, 'delete'), false);
    assert.equal(taskRouteCapabilityDecision(instructor, 'delete').reasonCode, 'TASK_DELETE_FORBIDDEN');
    assert.equal(canUseTaskRouteCapability(manager, 'review'), true);
    assert.equal(taskRouteCapabilityDecision(manager, 'review').allowed, true);
    assert.equal(taskRouteCapabilityDecision(manager, 'review').capability, 'action:tasks.review');
});

test('task route capabilities honor explicit deny before role defaults', () => {
    const deniedManager = {
        id: 14,
        role: 'manager',
        action_denylist: ['tasks.create', 'tasks.review']
    };
    const deniedDirector = {
        id: 15,
        role: 'director',
        action_denylist: ['tasks.delete']
    };

    assert.equal(taskRouteCapabilityDecision(deniedManager, 'create').allowed, false);
    assert.equal(taskRouteCapabilityDecision(deniedManager, 'create').source, 'explicit_deny');
    assert.equal(taskRouteCapabilityDecision(deniedManager, 'create').reasonCode, 'TASK_CREATE_FORBIDDEN');
    assert.equal(taskRouteCapabilityDecision(deniedManager, 'review').allowed, false);
    assert.equal(taskRouteCapabilityDecision(deniedDirector, 'delete').allowed, false);
    assert.equal(taskRouteCapabilityDecision(deniedDirector, 'delete').reasonCode, 'TASK_DELETE_FORBIDDEN');
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

test('drawer disables review and delete when explicit deny revokes a default role', () => {
    const actor = { id: 32, role: 'manager', action_denylist: ['tasks.review', 'tasks.delete'] };
    const task = { id: 403, status: 'done', visibility: 'team', owner_user_id: 44 };
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

test('task permission audit document records current bulk baseline without stale P0 wording', () => {
    const doc = fs.readFileSync(path.join(ROOT, 'docs', 'TASK_PERMISSIONS_AND_LEGACY_AUDIT.md'), 'utf8');

    assert.match(doc, /Task 15 re-baseline/);
    assert.match(doc, /older P0 bulk mutation finding is \*\*closed in the current runtime\*\*/);
    assert.match(doc, /TASK_BULK_MUTATION_FORBIDDEN/);
    assert.match(doc, /TASK_BULK_REASSIGN_FORBIDDEN/);
    assert.match(doc, /Task 25 completed the aggregate-only production legacy-data audit/);
    assert.match(doc, /verified `transaction_read_only=on`/);
    assert.match(doc, /persistent CRM table write grants for the audit role: `0`/);
    assert.match(doc, /active duplicate signature groups/);
    assert.match(doc, /requires a separate\s+explicit data-fix task/);
    assert.doesNotMatch(doc, /DATA_AUDIT_DEFERRED_NO_READONLY_CREDENTIAL/);
    assert.doesNotMatch(doc, /Gap P0/i);
    assert.doesNotMatch(doc, /Remaining risk:.*P0 bulk mutation/is);
    assert.doesNotMatch(doc, /counts? (?:are|=) zero/i);
});

test('Task Center consumes capability decisions and explains disabled drawer actions', () => {
    const page = fs.readFileSync(path.join(ROOT, 'js', 'tasks-page.js'), 'utf8');

    assert.match(page, /taskCapabilities = permsResult\.capabilities \|\| \{\}/);
    assert.match(page, /let taskPermissionsLoaded = false/);
    assert.match(page, /TASK_PERMISSIONS_LOADING/);
    assert.match(page, /taskCapabilityAllowed\('create'/);
    assert.match(page, /taskCapabilityDecision\('delete'/);
    assert.match(page, /taskPermissionReasonLabel\(reasons\[action\]\)/);
    assert.match(page, /data-task-drawer-action="review"/);
    assert.match(page, /data-task-drawer-action="delete"/);
});

test('Task Center create controls are hidden until task permissions hydrate', () => {
    const html = fs.readFileSync(path.join(ROOT, 'tasks.html'), 'utf8');

    assert.match(html, /class="board-tab" data-view="templates" hidden/);
    assert.match(html, /id="quickAdd"[^>]* hidden/);
    assert.match(html, /id="operationPackBar" hidden/);
});

test('task route mutation guards run before service and database work', () => {
    const route = fs.readFileSync(path.join(ROOT, 'routes', 'tasks.js'), 'utf8');
    const guardedRoutes = [
        "router.post('/ai-draft/commit', requireTaskRouteCapability('create'), async",
        "router.post('/ai-draft/bundle/commit', requireTaskRouteCapability('create'), async",
        "router.post('/:id/dependencies/quick-create', requireTaskRouteCapability('create'), async",
        "router.post('/operation-pack', requireTaskRouteCapability('create'), async",
        "router.post('/', requireTaskRouteCapability('create'), async",
        "router.post('/:id/review', requireTaskRouteCapability('review'), async",
        "router.delete('/:id', requireTaskRouteCapability('delete'), async",
        "router.post('/dedup-cleanup', requireTaskRouteCapability('delete'), async"
    ];

    for (const marker of guardedRoutes) {
        assert.ok(route.includes(marker), `${marker} must guard before handler`);
    }
});

test('permission registry owns canonical task route capabilities', () => {
    const actions = new Map(registry.ACTION_PERMISSIONS.map(entry => [entry.key, entry]));
    for (const key of ['tasks.create', 'tasks.delete', 'tasks.review']) {
        assert.ok(actions.has(key), `${key} must be registered`);
        assert.ok(actions.get(key).apiConsumers.some(consumer => consumer.file === 'routes/tasks.js'));
        assert.ok(actions.get(key).backendConsumers.some(consumer => consumer.file === 'routes/tasks.js'));
    }
});

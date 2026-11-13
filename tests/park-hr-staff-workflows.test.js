'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { withDeletionRouter } = require('./helpers/park-hr-deletion-router');

const RECOVERED = [
    ['GET', '/staff/9701/role-assignments'],
    ['GET', '/staff/9701/history'],
    ['GET', '/staff/9701/lifecycle-checklist'],
    ['GET', '/staff/9701/documents'],
    ['POST', '/staff/9701/documents'],
    ['GET', '/staff/9701/documents/9801/download'],
    ['GET', '/staff/9701/documents/9801/preview'],
    ['DELETE', '/staff/9701/documents/9801'],
    ['PUT', '/staff/9701/documents/9801/restore'],
    ['GET', '/staff/9701/medical-book'],
    ['POST', '/staff/9701/medical-book'],
    ['PATCH', '/staff/9701/medical-book/9801'],
    ['GET', '/staff/9701/resources'],
    ['POST', '/staff/9701/resources'],
    ['PUT', '/staff/9701/resources/9801/return'],
    ['PUT', '/staff/9701/resources/9801/status'],
    ['GET', '/resource-options'],
    ['GET', '/staff/9701/offboarding'],
    ['GET', '/staff/9701/offboarding-readiness'],
    ['POST', '/staff/9701/offboarding'],
    ['PUT', '/staff/9701/status'],
    ['PUT', '/staff/9701/pool-status'],
    ['GET', '/staff/9701/shifts'],
    ['GET', '/role-assignments/report'],
    ['PUT', '/staff/9701/onboarding-assignment'],
    ['PUT', '/staff/9701/profession-checklist'],
    ['POST', '/onboarding/start'],
    ['POST', '/onboarding/templates'],
    ['PUT', '/onboarding/9801/check'],
    ['PUT', '/company-structure']
];

const frontend = fs.readFileSync(path.join(__dirname, '../js/hr-page.js'), 'utf8');
function functionSource(name) {
    const start = frontend.indexOf(`async function ${name}(`);
    assert.ok(start >= 0);
    const end = frontend.indexOf('\n}', start);
    assert.ok(end > start);
    return frontend.slice(start, end + 2);
}
function moveHarness(overrides = {}) {
    const notices = [];
    const context = {
        canUseTeamWorkflow: () => true,
        teamAccessContext: () => 'park',
        teamLoadRequestSeq: 1,
        pendingStaffMoves: new Set(),
        teamStaff: [{ id: 9701, name: 'Synthetic Staff', hr_pool_status: 'core' }],
        ensureProfessionsLoaded: async () => {},
        bucketForStaff: () => 'workers',
        isInternStaff: () => false,
        preferredWorkerRoleForStaff: () => 'animator',
        staffMoveTargetOptions: () => [{ value: 'reserve', label: 'Reserve' }],
        professionSelectOptionsForStaffMove: () => [],
        formModal: async () => ({ targetBucket: 'reserve' }),
        buildStaffMovePayload: () => ({ hr_pool_status: 'reserve' }),
        showNotification: (...args) => notices.push(args),
        normalizeVisiblePeopleBucket: value => value,
        HR_TEAM_MOVE_TARGETS: [{ id: 'reserve', label: 'Reserve' }],
        loadTeam: async () => {}, refreshHrOperationalViews: async () => {},
        ...overrides
    };
    vm.createContext(context);
    vm.runInContext(functionSource('runStaffMove'), context);
    vm.runInContext(functionSource('openStaffMoveMenu'), context);
    return { context, notices, run: () => context.openStaffMoveMenu(9701, {}) };
}

test('all recovered routes are denied outside Park and in aggregated business scope', async () => {
    await withDeletionRouter(async ({ calls, request }) => {
        for (const [method, endpoint] of RECOVERED) {
            for (const [context, suffix] of [['dar', ''], ['event_genix', '?businessScope=all']]) {
                const count = calls.length;
                assert.equal((await request(endpoint + suffix, { method, context, body: method === 'GET' ? undefined : {} })).status, 403, endpoint);
                assert.equal(calls.length, count);
            }
        }
    });
});

test('ordinary staff viewers cannot read private metadata or binary documents', async () => {
    await withDeletionRouter(async ({ state, calls, request }) => {
        state.actor = { deny: ['hr.staff.manage'] };
        for (const endpoint of ['documents', 'documents/9801/preview', 'documents/9801/download', 'medical-book', 'resources', 'history', 'offboarding-readiness']) {
            for (const method of ['GET', 'HEAD']) {
                assert.equal((await request('/staff/9701/' + endpoint, { method })).status, 403, endpoint);
            }
        }
        assert.equal(calls.length, 0);
    });
});

const staffResponse = { success: true, data: { id: 9701, name: 'Synthetic staff', profile_revision: '812' } };

test('move sends the fresh card revision and surfaces a server conflict without retry', async () => {
    const writes = [];
    const harness = moveHarness({ hrFetch: async (endpoint, options) => {
        if (!options) return staffResponse;
        writes.push([endpoint, options]);
        return { success: false, error: 'Revision conflict' };
    } });
    assert.equal(await harness.run(), false);
    assert.equal(writes.length, 1);
    assert.equal(writes[0][1].headers['X-Staff-Profile-Revision'], '812');
    assert.deepEqual(harness.notices, [['Revision conflict', 'error']]);
});

test('move shows a transport failure and does not repeat the write', async () => {
    let writes = 0;
    const harness = moveHarness({ hrFetch: async (_endpoint, options) => {
        if (!options) return staffResponse;
        writes++;
        throw new Error('synthetic offline');
    } });
    assert.equal(await harness.run(), false);
    assert.equal(writes, 1);
    assert.equal(harness.notices[0][1], 'warning');
});

test('changing business during move confirmation cancels the write', async () => {
    let business = 'park';
    const harness = moveHarness({
        teamAccessContext: () => business,
        formModal: async () => { business = 'dar'; return { targetBucket: 'reserve' }; },
        hrFetch: async (_endpoint, options) => { assert.equal(options, undefined); return staffResponse; }
    });
    assert.equal(await harness.run(), false);
    assert.deepEqual(harness.notices, []);
});

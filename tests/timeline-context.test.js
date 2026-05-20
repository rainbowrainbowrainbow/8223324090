const test = require('node:test');
const assert = require('node:assert/strict');

const {
    DEFAULT_TIMELINE_CONTEXT,
    normalizeTimelineContext,
    timelineContextFromRequest,
    canAccessTimelineContext,
    canUseTimelineAction
} = require('../services/timelineContext');

test('timeline context defaults invalid or missing values to Event Genix', () => {
    assert.equal(normalizeTimelineContext(), DEFAULT_TIMELINE_CONTEXT);
    assert.equal(normalizeTimelineContext('unknown'), DEFAULT_TIMELINE_CONTEXT);
    assert.equal(normalizeTimelineContext('maysternya_doli'), 'maysternya_doli');
});

test('timeline context can be resolved from request query, body, or header', () => {
    assert.equal(timelineContextFromRequest({ query: { businessContext: 'maysternya_doli' } }), 'maysternya_doli');
    assert.equal(timelineContextFromRequest({ body: { business_context: 'maysternya_doli' } }), 'maysternya_doli');
    assert.equal(timelineContextFromRequest({ headers: { 'x-business-context': 'maysternya_doli' } }), 'maysternya_doli');
});

test('Maysternya Doli access is creator or explicit page allowlist only', () => {
    assert.equal(canAccessTimelineContext({ role: 'creator' }, 'maysternya_doli'), true);
    assert.equal(canAccessTimelineContext({ role: 'manager', pageAllowlist: ['/maysternya-doli'] }, 'maysternya_doli'), true);
    assert.equal(canAccessTimelineContext({ role: 'manager' }, 'maysternya_doli'), false);
});

test('Maysternya Doli actions are role-scoped inside the allowed surface', () => {
    const director = { role: 'director', pageAllowlist: ['/maysternya-doli'] };
    const managerWithExtraRole = { role: 'instructor', extraRoles: ['director'], pageAllowlist: ['/maysternya-doli'] };
    const creator = { role: 'creator' };

    assert.equal(canUseTimelineAction(director, 'maysternya_doli', 'create'), true);
    assert.equal(canUseTimelineAction(director, 'maysternya_doli', 'delete'), false);
    assert.equal(canUseTimelineAction(managerWithExtraRole, 'maysternya_doli', 'edit'), true);
    assert.equal(canUseTimelineAction(creator, 'maysternya_doli', 'delete'), true);
    assert.equal(canUseTimelineAction(creator, 'maysternya_doli', 'sales'), false);
});

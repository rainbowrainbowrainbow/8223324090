'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { applyMembershipAccess, buildMembershipAccess } = require('../services/businessMembership');
const { businessContextFromRequest } = require('../services/businessContext');
const { timelineContextFromRequest, canAccessTimelineContext, canUseTimelineAction } = require('../services/timelineContext');

function actor(context = null, overrides = {}) {
    const rows = [
        { organization_id: 1, business_id: 1, context_key: 'event_genix', business_modules: ['timeline'], access_mode: 'membership', role: 'animator', is_default: false },
        { organization_id: 1, business_id: 2, context_key: 'dar', business_modules: ['timeline'], access_mode: 'membership', role: 'director', is_default: true, ...overrides }
    ];
    const account = { id: 42, username: 'timeline_fixture', role: 'creator' };
    return applyMembershipAccess(account, buildMembershipAccess(account, rows, context));
}

test('timeline with no explicit business uses the fresh Dar membership instead of Park', () => {
    const user = actor();
    assert.equal(user.activeBusinessMembership.businessContext, 'dar');
    assert.equal(timelineContextFromRequest({ user, query: {}, headers: {} }), 'dar');
});

test('explicit active Park wins over default Dar without borrowing the Dar role', () => {
    const user = actor('event_genix');
    assert.equal(user.role, 'animator');
    assert.equal(timelineContextFromRequest({ user, query: {}, headers: {} }), 'event_genix');
    assert.equal(canUseTimelineAction(user, 'event_genix', 'settings'), false);
});

test('timeline settings obey the active membership capability and explicit deny', () => {
    assert.equal(canUseTimelineAction(actor(), 'dar', 'settings'), true);
    assert.equal(canUseTimelineAction(actor(null, { action_denylist: ['manage_settings'] }), 'dar', 'settings'), false);
    assert.equal(canUseTimelineAction(actor(null, { role: 'animator', action_allowlist: ['manage_settings'] }), 'dar', 'settings'), false);
    assert.equal(canUseTimelineAction(actor(null, { role: 'animator' }), 'dar', 'view'), true);
});

test('timeline legacy compatibility and explicit invalid context remain unchanged', () => {
    assert.equal(timelineContextFromRequest({ user: { role: 'creator' } }), 'event_genix');
    assert.equal(timelineContextFromRequest({ user: actor(), query: { businessContext: 'park' } }), 'event_genix');
    assert.equal(timelineContextFromRequest({ user: actor(), query: { businessContext: 'unknown' } }), 'unknown');
    assert.equal(canAccessTimelineContext(actor(), 'unknown'), false);
    assert.equal(canUseTimelineAction({ role: 'creator', business_contexts: ['maysternya_doli'] }, 'maysternya_doli', 'settings'), true);
});

test('ticket quote context keeps authenticated membership without trusting a pricing body override', () => {
    const source = fs.readFileSync(path.join(__dirname, '../routes/bookings.js'), 'utf8');
    const start = source.indexOf('function ticketBusinessContextFromAuthenticatedRequest(');
    const end = source.indexOf('\nfunction sendAdmissionTicketQuoteError', start);
    assert.ok(start >= 0 && end > start);
    const helper = vm.runInNewContext('(' + source.slice(start, end).trim() + ')', { businessContextFromRequest });
    assert.equal(helper({ user: actor(), query: {}, headers: {}, body: { businessContext: 'event_genix' } }), 'dar');
    assert.equal(helper({ user: actor('event_genix'), query: { businessContext: 'park' }, headers: {} }), 'event_genix');
});

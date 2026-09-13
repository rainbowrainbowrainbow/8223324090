'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function functionSource(file, start, end) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const first = source.indexOf(start);
    const last = source.indexOf(end, first);
    assert.ok(first >= 0 && last > first, `Missing canonical source boundaries: ${file}`);
    return source.slice(first, last);
}

function bookingHandoff({ attached, failure, automatic = false } = {}) {
    const calls = [];
    const context = {
        log: { warn() {}, error() {} },
        sideEffectsAllowedForContext: () => true,
        bookingLeadAutoCreateAllowedForContext: () => automatic,
        hasBookingLeadIdentity: () => true,
        attachLeadBookingLink: async () => { if (failure) throw failure; return attached; },
        ensureLeadForBooking: async () => { if (failure) throw failure; return attached; }
    };
    vm.createContext(context);
    vm.runInContext(functionSource('routes/bookings.js',
        'async function runOptionalBookingTransactionStep(', 'async function queueBookingEventInTransaction('), context);
    vm.runInContext(functionSource('routes/bookings.js',
        'async function syncBookingLeadHandoff(', '// Resolve animator line name'), context);
    return { context, calls, client: { query: async sql => { calls.push(sql); return { rows: [], rowCount: 0 }; } } };
}

for (const code of ['lead_reference_unavailable', 'lead_parent_update_failed', 'customer_parent_update_failed',
    'invalid_lead_reference', 'business_context_invalid', 'lead_transaction_required', 'lead_savepoint_cleanup_failed',
    'lead_transaction_conflict']) {
    test(`booking caller propagates ${code} after rolling back its optional savepoint`, async () => {
        const failure = Object.assign(new Error('Fixture integrity failure'), { code, statusCode: 409 });
        const fixture = bookingHandoff({ failure });
        await assert.rejects(fixture.context.syncBookingLeadHandoff(fixture.client,
            { id: 'fixture-booking', leadId: 101 }, 10, 'dar'), error => error === failure);
        assert.deepEqual(fixture.calls, ['SAVEPOINT booking_optional_step',
            'ROLLBACK TO SAVEPOINT booking_optional_step', 'RELEASE SAVEPOINT booking_optional_step']);
    });
}

test('PostgreSQL handoff deadlock becomes a retryable domain conflict after verified savepoint cleanup', async () => {
    const failure = Object.assign(new Error('Fixture deadlock'), { code: '40P01' });
    const fixture = bookingHandoff({ failure, automatic: true });
    await assert.rejects(fixture.context.syncBookingLeadHandoff(fixture.client,
        { id: 'fixture-booking' }, 10, 'dar'),
    error => error.code === 'lead_transaction_conflict' && error.statusCode === 409 && error.cause === failure);
    assert.deepEqual(fixture.calls, ['SAVEPOINT booking_optional_step',
        'ROLLBACK TO SAVEPOINT booking_optional_step', 'RELEASE SAVEPOINT booking_optional_step']);
});

for (const cleanupStep of ['ROLLBACK TO SAVEPOINT booking_optional_step', 'RELEASE SAVEPOINT booking_optional_step']) {
    test(`optional booking caller fails closed when ${cleanupStep} fails`, async () => {
        const fixture = bookingHandoff({ failure: new Error('Fixture optional infrastructure failure'), automatic: true });
        const cleanupFailure = new Error('Fixture savepoint cleanup failure');
        fixture.client.query = async sql => {
            fixture.calls.push(sql);
            if (sql === cleanupStep) throw cleanupFailure;
            return { rows: [], rowCount: 0 };
        };
        await assert.rejects(fixture.context.syncBookingLeadHandoff(fixture.client,
            { id: 'fixture-booking' }, 10, 'dar'), error => error === cleanupFailure);
        assert.ok(fixture.calls.includes(cleanupStep));
    });
}

test('explicit unavailable lead handoff cannot be reported as a successful optional skip', async () => {
    const fixture = bookingHandoff({ attached: { attached: false, reason: 'lead_not_found' } });
    await assert.rejects(fixture.context.syncBookingLeadHandoff(fixture.client,
        { id: 'fixture-booking', leadId: 101 }, 10, 'dar'),
    error => error.code === 'lead_reference_unavailable' && error.statusCode === 404);
});

test('ordinary automatic handoff infrastructure failure preserves the existing optional booking contract', async () => {
    const fixture = bookingHandoff({ failure: new Error('Fixture legacy schema outage'), automatic: true });
    assert.equal(await fixture.context.syncBookingLeadHandoff(fixture.client,
        { id: 'fixture-booking' }, 10, 'dar'), null);
    assert.deepEqual(fixture.calls, ['SAVEPOINT booking_optional_step',
        'ROLLBACK TO SAVEPOINT booking_optional_step', 'RELEASE SAVEPOINT booking_optional_step']);
});

test('Maysternya caller rejects parent UPDATE=0 before invoking lead service', async () => {
    let handoffCalls = 0;
    const context = {
        MAYSTERNYA_CONTEXT: 'maysternya_doli',
        resolveOrCreateMaysternyaCustomer: async () => 10,
        ensureLeadForBooking: async () => { handoffCalls += 1; return { attached: true, leadId: 101 }; },
        mapMaysternyaBookingForLead: () => ({ id: 'fixture-booking' })
    };
    vm.createContext(context);
    vm.runInContext(functionSource('services/maysternyaBookingWebhook.js',
        'async function ensureMaysternyaBookingLead(', 'async function createMaysternyaBotBooking('), context);
    await assert.rejects(context.ensureMaysternyaBookingLead({ query: async () => ({ rowCount: 0, rows: [] }) },
        { booking: {}, row: { id: 'fixture-booking' } }),
    error => error.code === 'booking_parent_update_failed' && error.statusCode === 409);
    assert.equal(handoffCalls, 0);
});

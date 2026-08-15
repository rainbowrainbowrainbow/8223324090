'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
    CREATE_CONFIRMATION,
    manifestHash,
    readPlan
} = require('../scripts/trusted-qa-run');

function plan(overrides = {}) {
    return {
        sourceCommit: 'a'.repeat(40),
        sourceBranch: 'codex/production-source',
        liveUrl: 'https://example.test',
        runId: 'qa-banquet-cancellation-1',
        businessContext: 'event_genix',
        testAccountId: 48,
        operatorUserId: 48,
        customerId: 219,
        programId: 'qa-banquet-cancel-v1',
        roomResourceId: 'room-marvel',
        lineId: 'qa-line-1',
        timeWindow: { date: '2099-08-15', from: '12:00', to: '18:00' },
        ttlMinutes: 30,
        maxEntityCount: 40,
        allowedEndpoints: ['POST /api/bookings/full', 'POST /api/bookings'],
        expectedEntityTypes: ['product', 'booking', 'banquet_group'],
        qaProduct: {
            create: true,
            id: 'qa-banquet-cancel-v1',
            code: 'QA-BANQ-CANCEL-V1',
            label: 'QA Banquet Cancellation',
            category: 'animation',
            duration: 60
        },
        ...overrides
    };
}

function withPlanFile(value, callback) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eventgenix-trusted-qa-plan-'));
    const file = path.join(directory, 'plan.json');
    fs.writeFileSync(file, JSON.stringify(value), 'utf8');
    try {
        return callback(file);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
}

test('trusted QA operator manifest hash is stable across input ordering', () => {
    const first = withPlanFile(plan(), readPlan);
    const second = withPlanFile(plan({
        allowedEndpoints: ['POST /api/bookings', 'POST /api/bookings/full'],
        expectedEntityTypes: ['banquet_group', 'booking', 'product']
    }), readPlan);

    assert.equal(manifestHash(first), manifestHash(second));
    assert.equal(first.allowedEndpoints[0], 'POST /api/bookings');
    assert.equal(CREATE_CONFIRMATION, 'CREATE_EXACT_TRUSTED_QA_RUN');
});

test('trusted QA operator plan rejects unbounded or incomplete manifests', () => {
    assert.throws(
        () => withPlanFile(plan({ maxEntityCount: 0 }), readPlan),
        /incomplete or outside bounded limits/
    );
    assert.throws(
        () => withPlanFile(plan({ roomResourceId: '' }), readPlan),
        /incomplete or outside bounded limits/
    );
    assert.throws(
        () => withPlanFile(plan({ lineId: '' }), readPlan),
        /incomplete or outside bounded limits/
    );
    assert.throws(
        () => withPlanFile(plan({ timeWindow: { date: '2099-08-15', from: '18:00', to: '12:00' } }), readPlan),
        /time window is invalid/
    );
    assert.throws(
        () => withPlanFile(plan({
            qaProduct: {
                ...plan().qaProduct,
                code: 'QA-PRODUCT-CODE-THAT-EXCEEDS-VARCHAR-20'
            }
        }), readPlan),
        /incompatible with the products schema/
    );
});

test('trusted QA operator binds line and execution window into the manifest hash', () => {
    const base = withPlanFile(plan(), readPlan);
    const otherLine = withPlanFile(plan({ lineId: 'qa-line-2' }), readPlan);
    const otherDate = withPlanFile(plan({ timeWindow: { date: '2099-08-16', from: '12:00', to: '18:00' } }), readPlan);
    assert.notEqual(manifestHash(base), manifestHash(otherLine));
    assert.notEqual(manifestHash(base), manifestHash(otherDate));
});

test('booking routes suppress persistent side effects and register the QA graph', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'bookings.js'), 'utf8');
    assert.match(source, /bookingCreateSideEffectsAllowed\(\)\s*\?\s*await syncManagerDepositForBooking/);
    assert.match(source, /if \(bookingCreateSideEffectsAllowed\(\)\) \{\s*await syncBookingLeadHandoff/);
    assert.match(source, /if \(bookingCreateSideEffectsAllowed\(\)\) \{\s*await syncBanquetActualMenuTask/);
    assert.match(source, /if \(bookingCreateSideEffectsAllowed\(\)\) _alertPush\(\)/);
    assert.match(source, /if \(bookingCreateSideEffectsAllowed\(\)\) \{\s*await reconcileBookingBanquetGroupsSafely/);
    assert.match(source, /fullCreateSideEffectsAllowed\(\)\s*\?\s*await syncManagerDepositForBooking/);
    assert.match(source, /if \(fullCreateSideEffectsAllowed\(\)\) \{\s*await reconcileBookingBanquetGroupsSafely/);
    assert.match(source, /registerQaEntity\(client, qaContext, 'banquet_group'/);
    assert.match(source, /'banquet_membership'/);
    assert.match(source, /'booking_banquet_link'/);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    BOOKING_FINANCE_SAVEPOINT,
    createBookingFinanceInTransaction,
    syncBookingFinanceInTransaction
} = require('../services/bookingFinanceSync');

function normalizedSql(text) {
    return String(text).replace(/\s+/g, ' ').trim();
}

function financeFixture({
    rows = [],
    categories = [{ id: 11, name: 'Бронювання', type: 'income', business_context: 'event_genix' }]
} = {}) {
    const state = {
        rows: rows.map(row => ({ ...row })),
        categories: categories.map(row => ({ ...row })),
        nextId: Math.max(0, ...rows.map(row => Number(row.id) || 0)) + 1,
        queries: []
    };

    const client = {
        async query(text, params = []) {
            const sql = normalizedSql(text);
            state.queries.push({ text: sql, params: [...params] });

            if (
                sql === `SAVEPOINT ${BOOKING_FINANCE_SAVEPOINT}`
                || sql === `RELEASE SAVEPOINT ${BOOKING_FINANCE_SAVEPOINT}`
                || sql === `ROLLBACK TO SAVEPOINT ${BOOKING_FINANCE_SAVEPOINT}`
            ) {
                return { rows: [], rowCount: 0 };
            }
            if (/^SELECT pg_advisory_xact_lock/i.test(sql)) {
                return { rows: [{}], rowCount: 1 };
            }
            if (/^SELECT id FROM finance_transactions/i.test(sql)) {
                const [bookingId, businessContext] = params;
                const matches = state.rows
                    .filter(row => (
                        row.booking_id === bookingId
                        && row.type === 'income'
                        && row.certificate_id == null
                        && (row.business_context || 'event_genix') === businessContext
                    ))
                    .sort((a, b) => a.id - b.id);
                return {
                    rows: matches.map(row => ({ id: row.id })),
                    rowCount: matches.length
                };
            }
            if (/^DELETE FROM finance_transactions/i.test(sql)) {
                const [id, bookingId, businessContext] = params;
                const index = state.rows.findIndex(row => (
                    row.id === id
                    && row.booking_id === bookingId
                    && row.type === 'income'
                    && row.certificate_id == null
                    && (row.business_context || 'event_genix') === businessContext
                ));
                if (index < 0) return { rows: [], rowCount: 0 };
                const [removed] = state.rows.splice(index, 1);
                return { rows: [{ id: removed.id }], rowCount: 1 };
            }
            if (/^UPDATE finance_transactions/i.test(sql)) {
                const [
                    amount,
                    description,
                    date,
                    paymentMethod,
                    id,
                    bookingId,
                    businessContext
                ] = params;
                const row = state.rows.find(candidate => (
                    candidate.id === id
                    && candidate.booking_id === bookingId
                    && candidate.type === 'income'
                    && candidate.certificate_id == null
                    && (candidate.business_context || 'event_genix') === businessContext
                ));
                if (!row) return { rows: [], rowCount: 0 };
                Object.assign(row, {
                    amount,
                    description,
                    date,
                    payment_method: paymentMethod
                });
                return { rows: [{ id: row.id }], rowCount: 1 };
            }
            if (/^SELECT id FROM finance_categories/i.test(sql)) {
                const [name, businessContext] = params;
                const match = state.categories
                    .filter(row => (
                        row.name === name
                        && row.type === 'income'
                        && (row.business_context || 'event_genix') === businessContext
                    ))
                    .sort((a, b) => a.id - b.id)[0];
                return {
                    rows: match ? [{ id: match.id }] : [],
                    rowCount: match ? 1 : 0
                };
            }
            if (/^INSERT INTO finance_transactions/i.test(sql)) {
                const [
                    businessContext,
                    categoryId,
                    amount,
                    description,
                    date,
                    paymentMethod,
                    bookingId,
                    createdBy
                ] = params;
                const row = {
                    id: state.nextId++,
                    business_context: businessContext,
                    type: 'income',
                    category_id: categoryId,
                    amount,
                    description,
                    date,
                    payment_method: paymentMethod,
                    booking_id: bookingId,
                    certificate_id: null,
                    created_by: createdBy
                };
                state.rows.push(row);
                return { rows: [{ id: row.id }], rowCount: 1 };
            }
            throw new Error(`Unexpected query: ${sql}`);
        }
    };

    return { client, state };
}

function booking(overrides = {}) {
    return {
        id: 'BK-FIN-1',
        business_context: 'event_genix',
        linked_to: null,
        status: 'confirmed',
        price: 1400,
        program_name: 'Святкування',
        date: '2026-07-18',
        payment_method: 'card',
        created_by: 'manager',
        ...overrides
    };
}

function silentLogger() {
    const messages = [];
    return {
        messages,
        logger: {
            warn(message) {
                messages.push({ level: 'warn', message });
            },
            error(message) {
                messages.push({ level: 'error', message });
            }
        }
    };
}

test('sync updates the canonical non-certificate booking income row', async () => {
    const { client, state } = financeFixture({
        rows: [
            {
                id: 7,
                business_context: 'event_genix',
                type: 'income',
                booking_id: 'BK-FIN-1',
                certificate_id: null,
                amount: 1000,
                description: 'Old',
                date: '2026-07-17',
                payment_method: 'cash'
            },
            {
                id: 8,
                business_context: 'event_genix',
                type: 'income',
                booking_id: 'BK-FIN-1',
                certificate_id: 44,
                amount: 1000,
                description: 'Certificate',
                date: '2026-07-17',
                payment_method: 'certificate'
            },
            {
                id: 9,
                business_context: 'dar',
                type: 'income',
                booking_id: 'BK-FIN-1',
                certificate_id: null,
                amount: 500,
                description: 'Other business',
                date: '2026-07-17',
                payment_method: 'cash'
            }
        ]
    });

    const result = await syncBookingFinanceInTransaction(client, booking());

    assert.deepEqual(result, {
        applied: true,
        action: 'updated',
        reason: null,
        bookingId: 'BK-FIN-1',
        businessContext: 'event_genix',
        financeTransactionId: 7,
        amount: 1400
    });
    assert.deepEqual(
        {
            amount: state.rows[0].amount,
            description: state.rows[0].description,
            date: state.rows[0].date,
            payment_method: state.rows[0].payment_method
        },
        {
            amount: 1400,
            description: 'Святкування (BK-FIN-1)',
            date: '2026-07-18',
            payment_method: 'card'
        }
    );
    assert.equal(state.rows[1].amount, 1000, 'certificate income must remain untouched');
    assert.equal(state.rows[2].amount, 500, 'another business context must remain untouched');
    assert.equal(state.queries.filter(query => /^INSERT INTO finance_transactions/i.test(query.text)).length, 0);
    assert.ok(state.queries.some(query => /certificate_id IS NULL/i.test(query.text)));
    const canonicalLookup = state.queries.find(query => /^SELECT id FROM finance_transactions/i.test(query.text));
    assert.match(canonicalLookup.text, /ORDER BY id ASC FOR UPDATE/i);
});

test('create inserts one booking income with the scoped Бронювання category', async () => {
    const { client, state } = financeFixture();

    const result = await createBookingFinanceInTransaction(
        client,
        booking({ id: 'BK-FIN-2', payment_method: null }),
        { createdBy: 'director' }
    );

    assert.equal(result.applied, true);
    assert.equal(result.action, 'inserted');
    assert.equal(state.rows.length, 1);
    assert.deepEqual(state.rows[0], {
        id: 1,
        business_context: 'event_genix',
        type: 'income',
        category_id: 11,
        amount: 1400,
        description: 'Святкування (BK-FIN-2)',
        date: '2026-07-18',
        payment_method: null,
        booking_id: 'BK-FIN-2',
        certificate_id: null,
        created_by: 'director'
    });
    const categoryQuery = state.queries.find(query => /^SELECT id FROM finance_categories/i.test(query.text));
    assert.deepEqual(categoryQuery.params, ['Бронювання', 'event_genix']);
});

test('finance synchronization skips unsupported and linked bookings without SQL', async () => {
    const cases = [
        [booking({ business_context: 'dar' }), 'business_context_not_supported'],
        [booking({ business_context: 'unknown_business' }), 'business_context_not_supported'],
        [booking({ linked_to: 'BK-ROOT' }), 'linked_booking']
    ];

    for (const [input, expectedReason] of cases) {
        const { client, state } = financeFixture();
        const result = await syncBookingFinanceInTransaction(client, input);

        assert.equal(result.applied, false);
        assert.equal(result.action, 'skipped');
        assert.equal(result.reason, expectedReason);
        assert.equal(state.queries.length, 0);
    }
});

test('preliminary, cancelled, and zero-price bookings remove one stale canonical finance row', async () => {
    for (const [input, expectedReason] of [
        [booking({ status: 'preliminary' }), 'preliminary_booking'],
        [booking({ status: 'cancelled' }), 'cancelled_booking'],
        [booking({ price: 0 }), 'zero_amount']
    ]) {
        const { client, state } = financeFixture({
            rows: [{
                id: 7,
                business_context: 'event_genix',
                type: 'income',
                booking_id: input.id,
                certificate_id: null,
                amount: 1400
            }]
        });
        const result = await syncBookingFinanceInTransaction(client, input, { optional: false });

        assert.equal(result.applied, true);
        assert.equal(result.action, 'deleted');
        assert.equal(result.reason, expectedReason);
        assert.equal(state.rows.length, 0);
    }
});

test('park context alias is normalized to the event_genix finance scope', async () => {
    const { client, state } = financeFixture();

    const result = await createBookingFinanceInTransaction(
        client,
        booking({ id: 'BK-FIN-PARK', business_context: 'park' })
    );

    assert.equal(result.applied, true);
    assert.equal(result.businessContext, 'event_genix');
    assert.equal(state.rows.length, 1);
    assert.equal(state.rows[0].business_context, 'event_genix');
});

test('missing finance category rolls back only the optional savepoint', async () => {
    const { client, state } = financeFixture({ categories: [] });
    const capture = silentLogger();

    const result = await createBookingFinanceInTransaction(
        client,
        booking({ id: 'BK-FIN-MISSING-CATEGORY' }),
        { logger: capture.logger }
    );

    assert.deepEqual(result, {
        applied: false,
        action: 'skipped',
        reason: 'optional_finance_failed',
        bookingId: 'BK-FIN-MISSING-CATEGORY',
        businessContext: 'event_genix',
        errorCode: 'BOOKING_FINANCE_CATEGORY_MISSING'
    });
    assert.ok(state.queries.some(query => query.text === `SAVEPOINT ${BOOKING_FINANCE_SAVEPOINT}`));
    assert.ok(state.queries.some(query => query.text === `ROLLBACK TO SAVEPOINT ${BOOKING_FINANCE_SAVEPOINT}`));
    assert.ok(state.queries.some(query => query.text === `RELEASE SAVEPOINT ${BOOKING_FINANCE_SAVEPOINT}`));
    assert.equal(state.rows.length, 0);
    assert.equal(capture.messages.filter(message => message.level === 'warn').length, 1);
});

test('required finance synchronization fails closed when the category is missing', async () => {
    const { client, state } = financeFixture({ categories: [] });

    await assert.rejects(
        createBookingFinanceInTransaction(
            client,
            booking({ id: 'BK-FIN-REQUIRED' }),
            { optional: false }
        ),
        error => error.code === 'BOOKING_FINANCE_CATEGORY_MISSING'
    );
    assert.equal(
        state.queries.some(query => query.text === `SAVEPOINT ${BOOKING_FINANCE_SAVEPOINT}`),
        false
    );
    assert.equal(state.rows.length, 0);
});

test('duplicate non-certificate finance rows fail closed instead of hiding overstatement', async () => {
    const { client } = financeFixture({
        rows: [{
            id: 7,
            business_context: 'event_genix',
            type: 'income',
            booking_id: 'BK-FIN-1',
            certificate_id: null,
            amount: 1000
        }, {
            id: 8,
            business_context: 'event_genix',
            type: 'income',
            booking_id: 'BK-FIN-1',
            certificate_id: null,
            amount: 1000
        }]
    });

    await assert.rejects(
        syncBookingFinanceInTransaction(client, booking(), { optional: false }),
        error => (
            error.code === 'BOOKING_FINANCE_DUPLICATE_ROWS'
            && error.details?.financeTransactionIds?.length === 2
        )
    );
});

test('retry is idempotent: the advisory-locked second call updates instead of inserting a duplicate', async () => {
    const { client, state } = financeFixture();
    const input = booking({ id: 'BK-FIN-RETRY' });

    const first = await createBookingFinanceInTransaction(client, input);
    const second = await createBookingFinanceInTransaction(
        client,
        { ...input, price: 1575 }
    );

    assert.equal(first.action, 'inserted');
    assert.equal(second.action, 'updated');
    assert.equal(state.rows.length, 1);
    assert.equal(state.rows[0].amount, 1575);
    assert.equal(
        state.queries.filter(query => /^INSERT INTO finance_transactions/i.test(query.text)).length,
        1
    );
    const advisoryQueries = state.queries.filter(query => /^SELECT pg_advisory_xact_lock/i.test(query.text));
    assert.equal(advisoryQueries.length, 2);
    assert.deepEqual(advisoryQueries[0].params, ['booking-finance:event_genix:BK-FIN-RETRY']);
    assert.deepEqual(advisoryQueries[1].params, advisoryQueries[0].params);
});

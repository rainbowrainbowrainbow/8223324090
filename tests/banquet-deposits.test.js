const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    attachAccountantTask,
    BanquetDepositError,
    confirmDeposit,
    createOrLoadDepositHandoff,
    getDepositProjectionById,
    getDepositProjectionForBooking
} = require('../services/banquetDeposits');

const ROOT = path.resolve(__dirname, '..');

function fakeDb(handler) {
    const queries = [];
    const client = {
        async query(text, params = []) {
            queries.push({ text, params });
            if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(String(text).trim())) {
                return { rows: [], rowCount: 0 };
            }
            return handler(String(text), params, queries);
        },
        release() {}
    };
    return {
        queries,
        db: client,
        pool: {
            connect: async () => client,
            query: client.query.bind(client)
        }
    };
}

function depositRow(overrides = {}) {
    return {
        id: 10,
        business_context: 'event_genix',
        banquet_group_id: 'BQ-1',
        primary_booking_id: 'BK-1',
        lead_id: 5,
        customer_id: 7,
        accountant_task_id: null,
        client_name_snapshot: 'Client One',
        event_date: '2099-06-23',
        banquet_number_snapshot: 'BQ-1',
        amount: 1000,
        payment_method: 'cash',
        status: 'accountant_verified',
        source_kind: 'legacy_booking_extra_data',
        source_payload: { source_booking_id: 'BK-1', source_path: 'extra_data.banquetDeposit' },
        manager_reported_at: null,
        manager_reported_by: null,
        verified_at: '2099-06-01T10:00:00.000Z',
        verified_by: 9,
        corrected_at: null,
        corrected_by: null,
        finance_transaction_id: null,
        meta: { booking_context: { paid_amount: 999 } },
        created_at: '2099-06-01T09:00:00.000Z',
        updated_at: '2099-06-01T10:00:00.000Z',
        ...overrides
    };
}

test('269 migration copies explicit deposit JSON only and keeps paid_amount as warning context', () => {
    const sql = fs.readFileSync(path.join(ROOT, 'db', 'migrations', '269_banquet_deposits.sql'), 'utf8');

    assert.match(sql, /MIGRATION_KIND: mixed/);
    assert.match(sql, /DATA_SCOPE: explicit deposit JSON in bookings\.extra_data only/i);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS banquet_deposits/);
    assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS idx_banquet_deposits_legacy_source_unique/);
    assert.match(sql, /ON CONFLICT DO NOTHING/);
    assert.match(sql, /'source_value', cr\.source_value/);
    assert.match(sql, /'all_explicit_deposit_markers', am\.markers/);
    assert.match(sql, /'original_extra_data', cr\.original_extra_data/);
    assert.match(sql, /'paid_amount_ignored'/);
    assert.match(sql, /b\.paid_amount AS booking_paid_amount/);
    assert.doesNotMatch(sql, /INSERT INTO finance_transactions/i);
    assert.doesNotMatch(sql, /UPDATE finance_transactions/i);

    const normalizedBlock = sql.slice(
        sql.indexOf('normalized_candidates AS'),
        sql.indexOf('enriched_candidates AS')
    );
    assert.match(normalizedBlock, /pc\.parsed_amount/);
    assert.doesNotMatch(normalizedBlock, /booking_paid_amount/i);
});

test('manager deposit upsert does not overwrite accounting-confirmed amount fields', () => {
    const service = fs.readFileSync(path.join(ROOT, 'services', 'banquetDeposits.js'), 'utf8');
    const updateStart = service.indexOf('UPDATE banquet_deposits');
    assert.ok(updateStart >= 0, 'manager deposit update SQL should exist');
    const updateBlock = service.slice(updateStart, service.indexOf('WHERE id = $13', updateStart));

    assert.match(updateBlock, /expected_amount = \$1/);
    assert.match(updateBlock, /amount = CASE/);
    assert.match(updateBlock, /paid_amount IS NULL/);
    assert.match(updateBlock, /payment_method IS NULL/);
    assert.match(updateBlock, /verified_at IS NULL/);
    assert.match(updateBlock, /verified_by IS NULL/);
    assert.doesNotMatch(updateBlock, /amount = \$1,\s*manager_status/);
});

test('getDepositProjectionForBooking reads copied deposit and ignores paid_amount as amount', async () => {
    const fixture = fakeDb(async text => {
        if (/FROM bookings b/i.test(text)) {
            return {
                rows: [{
                    id: 'BK-1',
                    business_context: 'event_genix',
                    customer_id: 7,
                    date: '2099-06-23',
                    label: 'Booking label',
                    group_name: 'Group label',
                    status: 'confirmed',
                    payment_method: 'cash',
                    payment_status: 'partial',
                    paid_amount: 999
                }]
            };
        }
        if (/FROM banquet_group_bookings bgb/i.test(text)) {
            return {
                rows: [{
                    group_id: 'BQ-1',
                    group_role: 'primary',
                    group_business_context: 'event_genix',
                    primary_booking_id: 'BK-1',
                    group_customer_id: 7,
                    group_date: '2099-06-23',
                    group_name: 'Banquet group',
                    group_status: 'active',
                    group_source: 'manual'
                }]
            };
        }
        if (/FROM \(\s*SELECT l\.\*/i.test(text)) {
            return { rows: [{ id: 5, business_context: 'event_genix', client_name: 'Lead Client', booking_id: 'BK-1' }] };
        }
        if (/FROM customers\s+WHERE id = \$1/i.test(text)) {
            return { rows: [{ id: 7, business_context: 'event_genix', name: 'Customer Client', lead_id: 5 }] };
        }
        if (/FROM banquet_deposits/i.test(text)) {
            return { rows: [depositRow()] };
        }
        throw new Error(`Unexpected query: ${text}`);
    });

    const projection = await getDepositProjectionForBooking('BK-1', 'event_genix', { db: fixture.db });

    assert.equal(projection.state, 'verified');
    assert.equal(projection.deposit.amount, 1000);
    assert.equal(projection.deposit.meta.booking_context.paid_amount, 999);
    assert.equal(projection.display.amount, 1000);
});

test('createOrLoadDepositHandoff reuses existing handoff instead of duplicating deposit rows', async () => {
    const fixture = fakeDb(async text => {
        if (/FROM leads\s+WHERE id = \$1/i.test(text)) {
            return {
                rows: [{
                    id: 15,
                    business_context: 'event_genix',
                    client_name: 'Existing Handoff Lead',
                    event_date: '2099-07-01',
                    booking_id: null,
                    status: 'booked',
                    pipeline_stage: 'deposit_received'
                }]
            };
        }
        if (/FROM customers c/i.test(text)) return { rows: [] };
        if (/FROM banquet_deposits/i.test(text)) {
            return {
                rows: [depositRow({
                    id: 55,
                    banquet_group_id: null,
                    primary_booking_id: null,
                    lead_id: 15,
                    accountant_task_id: 880,
                    status: 'needs_booking_link',
                    source_payload: { original: { stage: 'deposit_received' } }
                })]
            };
        }
        if (/INSERT INTO banquet_deposits/i.test(text)) {
            throw new Error('duplicate deposit insert must not run');
        }
        throw new Error(`Unexpected query: ${text}`);
    });

    const result = await createOrLoadDepositHandoff({
        leadId: 15,
        businessContext: 'event_genix',
        sourcePayload: { stage: 'deposit_received' },
        user: { id: 3 }
    }, { pool: fixture.pool });

    assert.equal(result.created, false);
    assert.equal(result.deposit.id, 55);
    assert.equal(result.deposit.accountantTaskId, 880);
    assert.deepEqual(result.deposit.sourcePayload.original, { stage: 'deposit_received' });
    assert.equal(fixture.queries.some(query => /INSERT INTO banquet_deposits/i.test(query.text)), false);
});

test('createOrLoadDepositHandoff creates actionable needs_booking_link row when lead has no booking', async () => {
    let insertParams = null;
    const fixture = fakeDb(async (text, params) => {
        if (/FROM leads\s+WHERE id = \$1/i.test(text)) {
            return {
                rows: [{
                    id: 15,
                    business_context: 'event_genix',
                    client_name: 'Lead Without Booking',
                    event_date: '2099-07-01',
                    booking_id: null,
                    status: 'booked',
                    pipeline_stage: 'deposit_received'
                }]
            };
        }
        if (/FROM customers c/i.test(text)) return { rows: [] };
        if (/FROM banquet_deposits/i.test(text)) return { rows: [] };
        if (/INSERT INTO banquet_deposits/i.test(text)) {
            insertParams = params;
            return {
                rows: [depositRow({
                    id: 55,
                    banquet_group_id: null,
                    primary_booking_id: null,
                    lead_id: 15,
                    customer_id: null,
                    client_name_snapshot: params[6],
                    event_date: params[7],
                    banquet_number_snapshot: params[8],
                    amount: params[9],
                    payment_method: params[10],
                    status: params[11],
                    source_kind: params[12],
                    source_payload: JSON.parse(params[13]),
                    manager_reported_at: params[14],
                    manager_reported_by: params[15],
                    meta: JSON.parse(params[16])
                })]
            };
        }
        throw new Error(`Unexpected query: ${text}`);
    });

    const result = await createOrLoadDepositHandoff({
        leadId: 15,
        businessContext: 'event_genix',
        sourcePayload: { stage: 'deposit_received' },
        user: { id: 3 }
    }, { pool: fixture.pool });

    assert.equal(result.created, true);
    assert.equal(result.projection.state, 'pending');
    assert.equal(result.projection.status, 'needs_booking_link');
    assert.equal(result.projection.needsBookingLink, true);
    assert.equal(insertParams[9], null);
    assert.equal(insertParams[11], 'needs_booking_link');
    assert.equal(JSON.parse(insertParams[13]).original.stage, 'deposit_received');
    assert.deepEqual(
        fixture.queries.map(query => String(query.text).trim()).filter(text => /^(BEGIN|COMMIT)$/i.test(text)),
        ['BEGIN', 'COMMIT']
    );
});

test('confirmDeposit verifies linked deposit with validated amount and payment method', async () => {
    let updateParams = null;
    const fixture = fakeDb(async (text, params) => {
        if (/FROM banquet_deposits/i.test(text) && /FOR UPDATE/i.test(text)) {
            return { rows: [depositRow({ status: 'manager_reported', amount: null, payment_method: null })] };
        }
        if (/UPDATE banquet_deposits/i.test(text)) {
            updateParams = params;
            return {
                rows: [depositRow({
                    amount: params[0],
                    payment_method: params[1],
                    status: params[2],
                    client_name_snapshot: params[3] || 'Client One',
                    event_date: params[4] || '2099-06-23',
                    banquet_number_snapshot: params[5] || 'BQ-1',
                    source_payload: JSON.parse(params[6]),
                    verified_at: params[7],
                    verified_by: params[8],
                    meta: JSON.parse(params[9])
                })]
            };
        }
        throw new Error(`Unexpected query: ${text}`);
    });

    const result = await confirmDeposit({
        depositId: 10,
        businessContext: 'event_genix',
        amount: '2500',
        paymentMethod: 'card',
        receivedDate: '2099-06-22',
        actor: { id: 9 },
        sourcePayload: { checkedBy: 'accountant' }
    }, { pool: fixture.pool });

    assert.equal(updateParams[0], 2500);
    assert.equal(updateParams[1], 'card');
    assert.equal(updateParams[2], 'accountant_verified');
    assert.equal(result.projection.state, 'verified');
    assert.equal(result.deposit.sourcePayload.accountantConfirmation.receivedDate, '2099-06-22');
    assert.equal(fixture.queries.some(query => /finance_transactions/i.test(query.text)), false);
});

test('confirmDeposit rejects unsupported payment method before update', async () => {
    const fixture = fakeDb(async text => {
        if (/FROM banquet_deposits/i.test(text) && /FOR UPDATE/i.test(text)) {
            return { rows: [depositRow({ status: 'manager_reported' })] };
        }
        if (/UPDATE banquet_deposits/i.test(text)) {
            throw new Error('update must not run');
        }
        throw new Error(`Unexpected query: ${text}`);
    });

    await assert.rejects(
        () => confirmDeposit({
            depositId: 10,
            businessContext: 'event_genix',
            amount: 1000,
            paymentMethod: 'wire'
        }, { pool: fixture.pool }),
        err => err instanceof BanquetDepositError && err.code === 'VALIDATION_PAYMENT_METHOD_INVALID'
    );
});

test('attachAccountantTask links task id without marking accountant correction', async () => {
    let updateParams = null;
    const fixture = fakeDb(async (text, params) => {
        if (/FROM banquet_deposits/i.test(text) && /FOR UPDATE/i.test(text)) {
            return { rows: [depositRow({ accountant_task_id: null, corrected_at: null, corrected_by: null })] };
        }
        if (/UPDATE banquet_deposits/i.test(text)) {
            updateParams = params;
            return {
                rows: [depositRow({
                    accountant_task_id: params[0],
                    source_payload: JSON.parse(params[1]),
                    meta: JSON.parse(params[2]),
                    corrected_at: null,
                    corrected_by: null
                })]
            };
        }
        throw new Error(`Unexpected query: ${text}`);
    });

    const result = await attachAccountantTask({
        depositId: 10,
        businessContext: 'event_genix',
        accountantTaskId: 88,
        sourcePayload: { source: 'lead_hook' }
    }, { pool: fixture.pool });

    assert.equal(updateParams[0], 88);
    assert.equal(result.deposit.accountantTaskId, 88);
    assert.equal(result.deposit.correctedAt, null);
    assert.equal(result.deposit.correctedBy, null);
    assert.equal(result.deposit.sourcePayload.accountantTask.taskId, 88);
});

test('getDepositProjectionById reads canonical deposit by id and business context', async () => {
    const fixture = fakeDb(async (text, params) => {
        if (/FROM banquet_deposits/i.test(text) && /WHERE id = \$1/i.test(text)) {
            assert.deepEqual(params, [10, 'event_genix']);
            return { rows: [depositRow({ status: 'needs_booking_link', primary_booking_id: null, banquet_group_id: null })] };
        }
        throw new Error(`Unexpected query: ${text}`);
    });

    const projection = await getDepositProjectionById({ depositId: 10, businessContext: 'event_genix' }, null, { db: fixture.db });

    assert.equal(projection.deposit.id, 10);
    assert.equal(projection.status, 'needs_booking_link');
    assert.equal(projection.needsBookingLink, true);
});

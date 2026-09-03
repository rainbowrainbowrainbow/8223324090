'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { finalizeJobSuccess } = require('../services/payments/paymentOutboxWorker');

function createMismatchFixture({ ownershipGranted = true } = {}) {
    const calls = [];
    const job = {
        id: 101,
        fiscal_profile_id: 11,
        fiscal_operation_id: 21,
        fiscal_register_id: 31,
        payment_order_id: 41,
        payment_refund_id: null,
        job_type: 'receipt_sell',
        operation_type: 'sale',
        attempts: 1,
        max_attempts: 5,
        locked_by: 'receipt-mismatch-test-worker',
        lock_token: '00000000-0000-4000-8000-000000000101',
        status: 'running',
        external_stage: 'receipt_lookup',
        payload: { external_stage: 'receipt_lookup' },
        fiscal_operation_external_stage: 'receipt_lookup',
        provider_operation_id: '00000000-0000-4000-8000-000000000201',
        provider_organization_id: 'organization-1',
        provider_register_id: 'register-1',
        provider_cashier_id: 'cashier-1',
        provider_shift_id: 'shift-1',
        total_amount_minor: '1000',
        fiscal_operation_amount_minor: '1000'
    };
    const existingReceipt = {
        fiscal_profile_id: job.fiscal_profile_id,
        fiscal_operation_id: job.fiscal_operation_id,
        payment_order_id: job.payment_order_id,
        payment_refund_id: null,
        receipt_type: 'sale',
        provider: 'checkbox',
        provider_receipt_id: job.provider_operation_id,
        provider_fiscal_code: 'immutable-original-fiscal-code',
        provider_serial: 'immutable-serial',
        provider_tax_url: null,
        provider_pdf_url: null,
        provider_qr_url: null,
        total_amount_minor: job.total_amount_minor,
        currency: 'UAH'
    };

    const client = {
        async query(sql, params = []) {
            const text = String(sql);
            calls.push({ sql: text, params });
            if (/^BEGIN$/i.test(text.trim()) || /^COMMIT$/i.test(text.trim()) || /^ROLLBACK$/i.test(text.trim())) {
                return { rows: [], rowCount: 0 };
            }
            if (/SELECT\s+job\.\*/i.test(text)) return { rows: [{ ...job }], rowCount: 1 };
            if (/FROM payment_order_items/i.test(text)) return { rows: [], rowCount: 0 };
            if (/FROM payment_outbox_jobs[\s\S]*FOR UPDATE/i.test(text)) {
                return ownershipGranted ? { rows: [{ id: job.id }], rowCount: 1 } : { rows: [], rowCount: 0 };
            }
            if (/FROM fiscal_receipts/i.test(text)) return { rows: [{ ...existingReceipt }], rowCount: 1 };
            return { rows: [], rowCount: 1 };
        },
        release() {}
    };
    return {
        calls,
        job,
        existingReceipt,
        dbPool: { async connect() { return client; } },
        providerReceipt: {
            id: job.provider_operation_id,
            status: 'DONE',
            receiptType: 'SELL',
            fiscalCode: 'conflicting-provider-fiscal-code',
            serial: existingReceipt.provider_serial,
            totalAmountMinor: job.total_amount_minor,
            providerOrganizationId: job.provider_organization_id,
            providerRegisterId: job.provider_register_id,
            providerCashierId: job.provider_cashier_id,
            providerShiftId: job.provider_shift_id
        }
    };
}

test('receipt mismatch evidence and incident commit atomically without overwriting the immutable receipt', async () => {
    const fixture = createMismatchFixture();
    const result = await finalizeJobSuccess(
        fixture.dbPool,
        { job: fixture.job },
        { receipt: fixture.providerReceipt, source: 'lookup' }
    );

    assert.equal(result.ok, false);
    assert.equal(result.receiptMismatch, true);
    assert.equal(result.error.code, 'fiscal_receipt_identity_mismatch');
    assert.ok(fixture.calls.some(call => /^COMMIT$/i.test(call.sql.trim())), 'failure evidence must commit');
    assert.ok(!fixture.calls.some(call => /^ROLLBACK$/i.test(call.sql.trim())), 'recorded mismatch must not roll back');

    const ownership = fixture.calls.find(call => /FROM payment_outbox_jobs[\s\S]*FOR UPDATE/i.test(call.sql));
    assert.ok(ownership, 'finalize must lock and verify the exact lease owner before evidence writes');
    assert.deepEqual(ownership.params, [
        fixture.job.id,
        fixture.job.fiscal_profile_id,
        fixture.job.locked_by,
        fixture.job.attempts,
        fixture.job.lock_token,
        300000
    ]);

    assert.ok(
        fixture.calls.some(call => /INSERT INTO fiscal_audit_events/i.test(call.sql)
            && call.params[1] === 'fiscal_receipt_mismatch_observed'),
        'append-only provider observation must survive'
    );
    assert.ok(
        fixture.calls.some(call => /INSERT INTO fiscal_operational_incidents/i.test(call.sql)
            && /fiscal\.receipt_mismatch/.test(call.sql)),
        'specific receipt mismatch incident must survive'
    );
    assert.ok(
        fixture.calls.some(call => /UPDATE payment_outbox_jobs[\s\S]*SET status = \$3::text/i.test(call.sql)
            && call.params[2] === 'dead'),
        'non-retryable mismatch must fail the owned job in the same transaction'
    );
    assert.ok(!fixture.calls.some(call => /INSERT INTO fiscal_receipts\s*\(/i.test(call.sql)));
    assert.ok(!fixture.calls.some(call => /UPDATE fiscal_operations[\s\S]*SET status = 'fiscalized'/i.test(call.sql)));
    assert.ok(!fixture.calls.some(call => /external_stage[^]*complete/i.test(call.sql)
        && /UPDATE payment_outbox_jobs/i.test(call.sql)), 'mismatch must not be recorded as complete');
    assert.equal(fixture.existingReceipt.provider_fiscal_code, 'immutable-original-fiscal-code');
});

test('stale finalize owner cannot record receipt mismatch evidence', async () => {
    const fixture = createMismatchFixture({ ownershipGranted: false });
    await assert.rejects(
        finalizeJobSuccess(
            fixture.dbPool,
            { job: fixture.job },
            { receipt: fixture.providerReceipt, source: 'lookup' }
        ),
        error => error?.code === 'payment_outbox_job_ownership_lost'
    );

    assert.ok(fixture.calls.some(call => /^ROLLBACK$/i.test(call.sql.trim())));
    assert.ok(!fixture.calls.some(call => /fiscal_receipt_mismatch_observed/i.test(call.sql)));
    assert.ok(!fixture.calls.some(call => /fiscal\.receipt_mismatch/i.test(call.sql)));
});

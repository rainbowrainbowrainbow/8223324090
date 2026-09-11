'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { loadIsolatedWorker } = require('./helpers/payment-worker-isolated');
const { CheckboxClientError } = require('../services/checkbox/errors');
const { paymentProgress } = require('../services/payments/paymentProgress');

function fixture(overrides = {}, { failAudit = false } = {}) {
    const providerContext = {
        provider: 'checkbox', provider_organization_id: 'org-test', provider_outlet_id: null,
        provider_register_id: 'register-test', provider_cashier_id: 'cashier-test',
        register_credential_ref: 'test-ref', cashier_credential_ref: 'test-cashier-ref',
        expected_is_test: true, fiscal_profile_id: 11, fiscal_location_id: 12, fiscal_register_id: 13
    };
    const hash = crypto.createHash('sha256').update(JSON.stringify(providerContext, Object.keys(providerContext).sort())).digest('hex');
    const job = {
        ...providerContext,
        id: 101, fiscal_operation_id: 21, payment_order_id: 41, fiscal_shift_id: 51,
        operation_fiscal_location_id: 12, fiscal_configuration_hash: hash,
        fiscal_request_snapshot: { provider_context: providerContext, fiscal_configuration_hash: hash },
        current_fiscal_profile_id: 11, current_fiscal_location_id: 12, current_fiscal_register_id: 13,
        current_provider_organization_id: 'org-test', current_provider_outlet_id: null,
        current_provider_register_id: 'register-test', current_provider_cashier_id: 'cashier-test',
        provider_license_ref: 'test-ref', current_provider_cashier_login_ref: 'test-cashier-ref',
        current_expected_is_test: 'true', register_provider: 'checkbox', register_status: 'active', register_feature_enabled: true,
        provider_operation_id: '00000000-0000-4000-8000-000000000021', provider_shift_id: 'shift-test',
        operation_type: 'sale', job_type: 'receipt_sell', fiscal_operation_status: 'pending',
        total_amount_minor: '1000', fiscal_operation_amount_minor: '1000', payment_method: 'cash',
        fiscal_shift_status: 'open', fiscal_shift_lifecycle_stage: 'OPENED',
        attempts: 1, max_attempts: 10, status: 'running', external_stage: 'receipt_lookup', payload: {},
        locked_by: 'test-worker', lock_token: '00000000-0000-4000-8000-000000000101',
        ...overrides
    };
    const calls = [];
    let before;
    let operationStatus = 'pending';
    const client = {
        async query(sql, params = []) {
            const text = sql.trim().replace(/\s+/g, ' ');
            calls.push({ sql: text, params });
            if (failAudit && text.includes("'payment_outbox_provider_pending'")) throw new Error('synthetic audit failure');
            if (text === 'BEGIN') { before = { job: structuredClone(job), operationStatus }; return { rows: [] }; }
            if (text === 'COMMIT') { before = null; return { rows: [] }; }
            if (text === 'ROLLBACK') {
                if (before) {
                    for (const key of Object.keys(job)) delete job[key];
                    Object.assign(job, before.job); operationStatus = before.operationStatus;
                }
                before = null; return { rows: [] };
            }
            if (/^(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)/.test(text)) return { rows: [] };
            if (text.startsWith('WITH candidate_registers AS MATERIALIZED')) {
                job.status = 'claimed'; job.attempts += 1; job.locked_by = params[2]; job.lock_token = params[6];
                return { rows: [structuredClone(job)] };
            }
            if (text.startsWith('SELECT job.*')) return { rows: [structuredClone(job)] };
            if (text.includes('FROM payment_order_items') || text.includes('FROM fiscal_receipts')) return { rows: [] };
            if (text.startsWith('SELECT status,') && text.includes('FROM payment_outbox_jobs')) return { rows: [] };
            if (text.startsWith('SELECT id FROM payment_outbox_jobs')) {
                const owns = ['claimed', 'running'].includes(job.status) && params[2] === job.locked_by
                    && params[3] === job.attempts && params[4] === job.lock_token;
                return { rows: owns ? [{ id: job.id }] : [] };
            }
            if (text.startsWith('SELECT shift.id')) return { rows: [{ id: job.fiscal_shift_id }] };
            if (text.startsWith('UPDATE payment_outbox_jobs job') && text.includes('portal_closed_active_recovery_used')) {
                assert.notEqual(job.payload.portal_closed_sync_observed, true);
                return { rows: [] };
            }
            if (text.startsWith('UPDATE payment_outbox_jobs')) {
                assert.equal(params[0], job.id);
                assert.equal(params[1], job.fiscal_profile_id);
                if (text.includes("status = 'queued', attempts")) {
                    job.status = 'queued'; job.attempts -= 1;
                    job.payload = { ...job.payload, ...JSON.parse(params[2]) };
                    job.next_run_at = params[3]; job.lock_token = null; job.last_error_code = null;
                } else if (text.includes('status = $3::text')) {
                    job.status = params[2]; job.last_error_code = params[4]; job.lock_token = null;
                } else if (text.includes("status = 'succeeded'")) {
                    job.status = 'succeeded'; job.last_error_code = null; job.lock_token = null;
                } else if (text.includes('payload = payload ||')) {
                    const patch = JSON.parse(params[2]);
                    job.payload = { ...job.payload, ...patch }; job.external_stage = patch.external_stage;
                } else if (text.includes("status = 'running'")) job.status = 'running';
                else assert.fail('Unexpected job update: ' + text);
                return { rows: [{ id: job.id }] };
            }
            if (text.startsWith('UPDATE fiscal_operations')) {
                if (text.includes("status = 'fiscalized'")) operationStatus = 'fiscalized';
                if (text.includes('status = $3::text')) operationStatus = params[2];
                return { rows: [{ id: job.fiscal_operation_id }] };
            }
            if (/^(UPDATE payment_orders|UPDATE fiscal_shifts|INSERT INTO fiscal_audit_events|INSERT INTO fiscal_operational_incidents|INSERT INTO fiscal_receipts)/.test(text)) return { rows: [{ id: 1 }] };
            assert.fail('Unexpected synthetic SQL: ' + text);
        },
        release() {}
    };
    return { job, calls, dbPool: { connect: async () => client }, get operationStatus() { return operationStatus; } };
}

function pendingError() {
    return new CheckboxClientError('checkbox_receipt_pending', 'pending', {
        status: 202, retryable: true, unknown: true, details: { providerStatus: 'CREATED' }
    });
}

function claim(job) {
    job.attempts += 1; job.status = 'running'; job.lock_token = crypto.randomUUID();
    return { job: structuredClone(job) };
}

test('15 known pending checks preserve earlier failures, durable deadline, audit and lease fencing across restarts', async () => {
    const clock = { now: Date.parse('2026-09-11T10:00:00Z') };
    const f = fixture({ attempts: 3 });
    let deadline;
    for (let index = 0; index < 15; index += 1) {
        const { worker } = loadIsolatedWorker(clock);
        const context = index === 0 ? { job: structuredClone(f.job) } : claim(f.job);
        const result = await worker.finalizeJobFailure(f.dbPool, context, worker.classifyWorkerError(pendingError()));
        assert.equal(result.pending, true);
        assert.equal(f.job.status, 'queued');
        assert.equal(f.job.attempts, 2, 'only known pending claim refunded; old errors retained');
        assert.equal(f.job.payload.provider_pending_wait.checkCount, index + 1);
        deadline ||= f.job.payload.provider_pending_wait.deadlineAt;
        assert.equal(f.job.payload.provider_pending_wait.deadlineAt, deadline);
        assert.ok([5000, 10000].includes(result.retryWakeupDelayMs));
        await assert.rejects(worker.finalizeJobFailure(f.dbPool, context, worker.classifyWorkerError(pendingError())), /ownership was lost/);
        clock.now += result.retryWakeupDelayMs;
    }
    assert.ok(clock.now >= Date.parse(deadline));
    const { worker } = loadIsolatedWorker(clock);
    const expired = await worker.finalizeJobFailure(f.dbPool, claim(f.job), worker.classifyWorkerError(pendingError()));
    assert.equal(expired.error.code, 'checkbox_pending_wait_expired');
    assert.equal(f.job.status, 'dead');
    assert.equal(f.operationStatus, 'unknown');
    assert.equal(expired.retryWakeupDelayMs, null);
    assert.equal(f.calls.filter(call => call.sql.includes("'payment_outbox_provider_pending'")).length, 15);
    assert.ok(f.calls.some(call => call.sql.startsWith('UPDATE fiscal_operations') && call.params[5] === null));
});

test('deadline/invalid marker stops actual worker before any provider call, including after restart', async () => {
    for (const invalid of [false, true]) {
        const clock = { now: Date.parse('2026-09-11T10:00:00Z') };
        const { policy } = loadIsolatedWorker(clock);
        const f = fixture({ payload: { provider_pending_wait: policy.nextPendingWait({}).wait } });
        if (invalid) f.job.payload.provider_pending_wait.deadlineAt = 'invalid';
        clock.now += 120000;
        const { worker } = loadIsolatedWorker(clock);
        let providerCalls = 0;
        const result = await worker.processOnePaymentOutboxJob({
            dbPool: f.dbPool, job: structuredClone(f.job),
            provider: { createForContext() { providerCalls += 1; throw new Error('must not create provider'); } }
        });
        assert.equal(result.error.code, invalid ? 'checkbox_pending_wait_invalid' : 'checkbox_pending_wait_expired');
        assert.equal(providerCalls, 0);
        assert.equal(f.job.status, 'dead');
    }
});

test('unknown and terminal errors never enter the known-pending path or refund attempts', async () => {
    const { worker } = loadIsolatedWorker();
    const errors = [
        new Error('network timeout'),
        ...[401, 409, 422, 429, 500].map(status => new CheckboxClientError('checkbox_provider_error', 'synthetic', { status, retryable: status >= 429, unknown: true })),
        new CheckboxClientError('checkbox_receipt_uuid_mismatch', 'mismatch', { retryable: false }),
        new CheckboxClientError('checkbox_receipt_pending', 'missing status', { retryable: true, unknown: true }),
        new worker.PaymentOutboxWorkerError('receipt_lookup_required_before_retry', 'not found', { retryable: true, unknown: true }),
        new worker.PaymentOutboxWorkerError('checkbox_shift_open_pending', 'malformed', { retryable: true, unknown: true, details: { providerStatus: 'MALFORMED' } })
    ];
    for (const error of errors) {
        const f = fixture({ attempts: 10 });
        const result = await worker.finalizeJobFailure(f.dbPool, { job: structuredClone(f.job) }, worker.classifyWorkerError(error));
        assert.notEqual(result.pending, true);
        assert.equal(f.job.attempts, 10);
        assert.equal(f.job.status, 'dead');
        assert.equal(f.job.payload.provider_pending_wait, undefined);
    }
});

test('pending classification is limited to post-submit sale and exact shift lookup, not returns or validation', async () => {
    const { worker } = loadIsolatedWorker();
    for (const changes of [
        { external_stage: 'receipt_validation' }, { job_type: 'receipt_return', operation_type: 'return' },
        { job_type: 'service_receipt', operation_type: 'service_out' }, { job_type: 'shift_close', operation_type: 'shift_close' }
    ]) {
        const f = fixture({ ...changes, attempts: 10 });
        const result = await worker.finalizeJobFailure(f.dbPool, { job: structuredClone(f.job) }, worker.classifyWorkerError(pendingError()));
        assert.notEqual(result.pending, true);
        assert.equal(f.job.status, 'dead');
    }
});

for (const [business, route] of [['event_genix', 'park_test'], ['dar', 'dar_test']]) {
test(`${route}: actual post-submit sale converges through exact lookups, never a second SELL`, async () => {
    const clock = { now: Date.parse('2026-09-11T10:00:00Z') };
    const f = fixture({ external_stage: 'auth', payment_status: 'confirmed', business_context: business, fiscal_sale_route_option_id: route });
    let sell = 0, lookups = 0;
    const receipt = { id: f.job.provider_operation_id, status: 'DONE', receiptType: 'SELL', fiscalCode: 'test-code', serial: 'test-serial',
        totalAmountMinor: '1000', providerOrganizationId: 'org-test', providerRegisterId: 'register-test',
        providerCashierId: 'cashier-test', providerShiftId: 'shift-test' };
    const provider = {
        prepareMutation: async () => {}, validateSale: async () => {},
        async submitSaleReceipt(input) { sell += 1; await input.beforeExternalMutation(); throw pendingError(); },
        async lookupReceipt(input) {
            assert.equal(input.providerOperationId, receipt.id);
            assert.equal(input.fiscalOperation.fiscal_register_id, 13, 'both routes retain the same physical register');
            lookups += 1;
            if (lookups < 12) throw pendingError();
            return { found: true, receipt };
        }
    };
    for (let index = 0; index < 13; index += 1) {
        const { worker } = loadIsolatedWorker(clock);
        const job = index === 0 ? structuredClone(f.job) : claim(f.job).job;
        const result = await worker.processOnePaymentOutboxJob({ dbPool: f.dbPool, job, provider });
        if (index < 12) {
            assert.equal(result.pending, true, JSON.stringify(result));
            clock.now += result.retryWakeupDelayMs;
        } else assert.equal(result.ok, true, JSON.stringify(result));
    }
    assert.equal(sell, 1); assert.equal(lookups, 12);
    assert.equal(f.job.status, 'succeeded'); assert.equal(f.operationStatus, 'fiscalized');
});
}

test('shift CREATED/OPENING uses exact UUID lookup; disappearance after observed pending never reopens', async () => {
    const clock = { now: Date.parse('2026-09-11T10:00:00Z') };
    const { worker } = loadIsolatedWorker(clock);
    const f = fixture({ job_type: 'shift_open', operation_type: 'shift_open', external_stage: 'auth' });
    const context = { job: f.job, async recordStage(stage) { f.job.external_stage = stage; }, assertMutationOwnership: async () => {} };
    let opens = 0, lookups = 0;
    const provider = {
        async openShift(input) { opens += 1; await input.beforeExternalMutation(); return { id: input.providerRequestUuid, status: 'CREATED' }; },
        async lookupShift(input) { lookups += 1; return { id: input.providerOperationId, status: lookups < 2 ? 'OPENING' : 'OPENED' }; }
    };
    for (let index = 0; index < 2; index += 1) {
        if (index) claim(f.job);
        let pending;
        await assert.rejects(worker.runShiftJob(provider, context), asyncError => {
            pending = asyncError;
            assert.equal(asyncError.code, 'checkbox_shift_open_pending'); return true;
        });
        const result = await worker.finalizeJobFailure(f.dbPool, { job: structuredClone(f.job) },
            worker.classifyWorkerError(pending));
        assert.equal(result.pending, true);
        clock.now += result.retryWakeupDelayMs;
    }
    const result = await worker.runShiftJob(provider, context);
    assert.equal(result.response.status, 'OPENED'); assert.equal(opens, 1); assert.equal(lookups, 2);
    provider.lookupShift = async () => { throw new CheckboxClientError('not_found', 'not found', { status: 404 }); };
    for (let i = 0; i < 2; i += 1) {
        await assert.rejects(worker.runShiftJob(provider, context), error => error.code === 'checkbox_pending_shift_not_found');
    }
    assert.equal(opens, 1);
    provider.lookupShift = async () => ({ id: 'other-shift', status: 'CREATED' });
    await assert.rejects(worker.runShiftJob(provider, context), error => error.code === 'checkbox_shift_open_identity_mismatch');
});

test('immutable test/real scope drift stops actual worker before provider and shared-register claim contract stays intact', async () => {
    const { worker } = loadIsolatedWorker();
    const f = fixture({ current_expected_is_test: 'false' });
    let calls = 0;
    const result = await worker.processOnePaymentOutboxJob({ dbPool: f.dbPool, job: structuredClone(f.job), provider: { createForContext() { calls += 1; } } });
    assert.equal(result.error.code, 'fiscal_provider_context_drift'); assert.equal(calls, 0);
    let sql;
    await worker.claimPaymentOutboxJobs({ query: async statement => { sql = statement; return { rows: [] }; } });
    assert.match(sql, /FOR UPDATE OF fr SKIP LOCKED/);
    assert.match(sql, /active_job.status IN \('claimed', 'running'\)/);
});

test('progress exposes only canonical stages and available timestamps, never payloads or fake completion', () => {
    const now = Date.parse('2026-09-11T10:00:00Z');
    const { policy } = loadIsolatedWorker({ now });
    const job = { job_type: 'receipt_sell', status: 'queued', external_stage: 'receipt_lookup',
        next_run_at: new Date(now + 5000).toISOString(), payload: { provider_pending_wait: policy.nextPendingWait({}).wait, secret: 'synthetic-hidden' } };
    const args = { order: { payment_status: 'confirmed', fiscal_status: 'pending' }, job, operation: {}, now };
    assert.equal(paymentProgress(args).stage, 'awaiting_receipt');
    assert.equal(paymentProgress(args).stageUpdatedAt, new Date(now).toISOString());
    assert.equal(paymentProgress({ ...args, job: { ...job, payload: {} } }).stageUpdatedAt, null);
    assert.equal(paymentProgress({ ...args, now: now + 120000 }).nextCheckAt, null);
    assert.equal(paymentProgress({ ...args, now: now + 120000 }).attentionReason, 'checkbox_pending_wait_expired');
    assert.equal(paymentProgress({ ...args, now: now + 120000 }).stageUpdatedAt, null);
    assert.equal(paymentProgress({ ...args, order: { payment_status: 'unpaid' } }).stage, 'awaiting_payment');
    assert.equal(paymentProgress({ order: args.order, operation: { related_shift_lifecycle_stage: 'OPENING' }, job: { external_stage: 'auth' } }).stage, 'awaiting_shift');
    assert.equal(paymentProgress({ ...args, operation: { status: 'fiscalized', completed_at: new Date(now).toISOString() }, job: { ...job, status: 'succeeded' } }).stage, 'complete');
    assert.equal(paymentProgress({ ...args, order: { payment_status: 'unpaid' }, operation: { status: 'fiscalized' } }).attentionReason, 'payment_fiscal_status_conflict');
    const completed = paymentProgress({ ...args, now: now + 120000, operation: { status: 'fiscalized' }, job: { ...job, status: 'succeeded' } });
    assert.equal(completed.attentionReason, null);
    assert.equal(completed.waitDeadlineAt, null);
    assert.equal(paymentProgress({ ...args, job: { ...job, status: 'failed', last_error_code: 'checkbox_network_unknown' } }).stage, 'checking_receipt');
    assert.ok(!JSON.stringify(paymentProgress(args)).includes('synthetic-hidden'));
    assert.deepEqual(Object.keys(paymentProgress(args)).sort(), ['attentionReason', 'lastCheckAt', 'nextCheckAt', 'stage', 'stageUpdatedAt', 'waitDeadlineAt']);
});

test('pending audit failure rolls back attempt refund and deadline; late failure cannot regress succeeded job', async () => {
    const { worker } = loadIsolatedWorker();
    const f = fixture({}, { failAudit: true });
    const before = structuredClone(f.job);
    await assert.rejects(worker.finalizeJobFailure(f.dbPool, { job: structuredClone(f.job) }, worker.classifyWorkerError(pendingError())), /synthetic audit failure/);
    assert.deepEqual(f.job, before);
    assert.equal(f.calls.at(-1).sql, 'ROLLBACK');
    assert.ok(!f.calls.some(call => call.sql === 'COMMIT'));
    const done = fixture({ status: 'succeeded', lock_token: null });
    await assert.rejects(worker.finalizeJobFailure(done.dbPool, { job: before }, worker.classifyWorkerError(pendingError())), /ownership was lost/);
    await assert.rejects(worker.finalizeJobSuccess(done.dbPool, { job: before }, { source: 'receipt_lookup', receipt: { status: 'DONE' } }), /ownership was lost/);
    assert.equal(done.job.status, 'succeeded');
    assert.ok(!done.calls.some(call => /^(INSERT|UPDATE)/.test(call.sql)));
});

test('pending policy rejects corrupt/future persisted state and caps last scheduled read at deadline', () => {
    const now = Date.parse('2026-09-11T10:00:00Z');
    const { policy } = loadIsolatedWorker({ now });
    const initial = policy.nextPendingWait({}, now).wait;
    for (const value of [null, [], {}, { ...initial, checkCount: 0 },
        { ...initial, lastCheckAt: new Date(now + 1).toISOString() },
        { ...initial, deadlineAt: new Date(now + 240000).toISOString() }]) {
        assert.equal(policy.pendingWaitStopCode({ provider_pending_wait: value }, now), 'checkbox_pending_wait_invalid');
    }
    const next = policy.nextPendingWait({ provider_pending_wait: initial }, now + 119999);
    assert.equal(next.delayMs, 1);
    assert.equal(next.wait.startedAt, initial.startedAt);
    assert.equal(next.wait.deadlineAt, initial.deadlineAt);
});

test('actual batch treats known pending as waiting, not degraded, and schedules only bounded fake wakeups', async () => {
    for (const elapsed of [0, 30000]) {
        const clock = { now: Date.parse('2026-09-11T10:00:00Z') };
        const f = fixture({ attempts: 0, status: 'queued' });
        const isolated = loadIsolatedWorker(clock, { providerFactory: () => ({
            async lookupReceipt() { throw pendingError(); },
            submitSaleReceipt() { assert.fail('pending batch must not submit sale'); }
        }) });
        if (elapsed) f.job.payload.provider_pending_wait = isolated.policy.nextPendingWait({}).wait;
        clock.now += elapsed;
        const summary = await isolated.worker.processPaymentOutboxJobs({ dbPool: f.dbPool, batchSize: 1, throwOnDegraded: true });
        assert.equal(summary.pending, 1);
        assert.equal(summary.failed, 0);
        assert.equal(summary.succeeded, 0);
        assert.equal(isolated.timers.length, 1);
        assert.equal(isolated.timers[0].delay, elapsed ? 10000 : 5000);
        assert.equal(isolated.wakeups.length, 0);
        isolated.timers[0].callback();
        assert.equal(isolated.wakeups.length, 1);
        assert.equal(isolated.wakeups[0].batchSize, 1);
    }
});

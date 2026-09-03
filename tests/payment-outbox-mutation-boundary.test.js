const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
    assertImmutableProviderContext,
    claimPaymentOutboxJobs,
    externalStage,
    runReceiptReturnJob,
    runReceiptSaleJob,
    runServiceReceiptJob,
    runShiftJob,
    safePublishFiscalEvent
} = require('../services/payments/paymentOutboxWorker');

function stableJson(value) {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function immutableProviderContext(overrides = {}) {
    const providerContext = {
        provider: 'checkbox',
        provider_organization_id: 'organization-test',
        provider_outlet_id: null,
        provider_register_id: 'register-test',
        provider_cashier_id: 'cashier-test',
        register_credential_ref: 'register-test-ref',
        cashier_credential_ref: 'cashier-test-ref',
        expected_is_test: true,
        fiscal_profile_id: 11,
        fiscal_location_id: 12,
        fiscal_register_id: 13,
        crm_profile_key: 'event_genix',
        legal_entity_key: 'test-fop',
        register_alias: 'middle',
        ...(overrides.providerContext || {})
    };
    const hash = crypto.createHash('sha256').update(stableJson(providerContext)).digest('hex');
    return {
        job: {
            fiscal_profile_id: 11,
            operation_fiscal_location_id: 12,
            fiscal_register_id: 13,
            provider_organization_id: 'organization-test',
            provider_outlet_id: null,
            provider_register_id: 'register-test',
            provider_cashier_id: 'cashier-test',
            register_credential_ref: 'register-test-ref',
            cashier_credential_ref: 'cashier-test-ref',
            expected_is_test: true,
            fiscal_configuration_hash: hash,
            fiscal_request_snapshot: {
                fiscal_configuration_hash: hash,
                provider_context: providerContext
            },
            current_fiscal_profile_id: 11,
            current_fiscal_location_id: 12,
            current_fiscal_register_id: 13,
            current_profile_crm_profile_key: 'event_genix',
            current_crm_profile_key: 'event_genix',
            current_legal_entity_key: 'test-fop',
            register_alias: 'middle',
            current_provider_organization_id: 'organization-test',
            current_provider_outlet_id: null,
            current_provider_register_id: 'register-test',
            current_provider_cashier_id: 'cashier-test',
            provider_license_ref: 'register-test-ref',
            current_provider_cashier_login_ref: 'cashier-test-ref',
            current_expected_is_test: 'true',
            register_provider: 'checkbox',
            register_status: 'active',
            register_feature_enabled: true,
            ...(overrides.job || {})
        }
    };
}

function shiftContext(jobType, stages) {
    return {
        job: {
            job_type: jobType,
            external_stage: 'auth',
            provider_operation_id: crypto.randomUUID(),
            provider_shift_id: jobType === 'shift_close' ? crypto.randomUUID() : null,
            fiscal_shift_status: jobType === 'shift_close' ? 'open' : 'opening',
            fiscal_shift_lifecycle_stage: jobType === 'shift_close' ? 'OPENED' : 'CREATED',
            payload: {}
        },
        async recordStage(stage) {
            stages.push(stage);
        },
        async assertMutationOwnership() {}
    };
}

function saleContext(stages) {
    return {
        job: {
            job_type: 'receipt_sell',
            operation_type: 'sale',
            external_stage: 'auth',
            provider_operation_id: crypto.randomUUID(),
            provider_shift_id: crypto.randomUUID(),
            fiscal_shift_status: 'open',
            fiscal_shift_lifecycle_stage: 'OPENED',
            payment_method: 'cash',
            source_snapshot: { tender: 'cash' }
        },
        items: [{ tax_mode: 'untaxed', provider_tax_id: null }],
        async recordStage(stage) {
            stages.push(stage);
        },
        async assertMutationOwnership() {}
    };
}

function serviceContext(stages, overrides = {}) {
    return {
        job: {
            job_type: 'service_receipt',
            operation_type: 'service_in',
            external_stage: 'auth',
            provider_operation_id: crypto.randomUUID(),
            fiscal_operation_status: 'pending',
            attempts: 1,
            payload: { external_stage: 'auth' },
            fiscal_operation_external_stage: 'auth',
            fiscal_request_snapshot: { external_stage: 'auth' },
            ...overrides
        },
        async recordStage(stage) {
            stages.push(stage);
        },
        async assertMutationOwnership() {}
    };
}

function returnContext(stages, overrides = {}) {
    return {
        job: {
            job_type: 'receipt_return',
            operation_type: 'return',
            external_stage: 'auth',
            provider_operation_id: crypto.randomUUID(),
            fiscal_operation_status: 'pending',
            attempts: 1,
            payload: { external_stage: 'auth' },
            fiscal_operation_external_stage: 'auth',
            fiscal_request_snapshot: { external_stage: 'auth' },
            ...overrides
        },
        items: [],
        async recordStage(stage) {
            stages.push(stage);
        },
        async assertMutationOwnership() {}
    };
}

test('shift mutation stage is not recorded when provider fails before its mutation callback', async t => {
    for (const jobType of ['shift_open', 'shift_close']) {
        await t.test(jobType, async () => {
            const stages = [];
            const expected = new Error(`${jobType}-before-boundary`);
            const provider = {
                async prepareMutation() {},
                async [jobType === 'shift_open' ? 'openShift' : 'closeShift']() {
                    throw expected;
                }
            };

            await assert.rejects(() => runShiftJob(provider, shiftContext(jobType, stages)), error => error === expected);
            assert.deepEqual(stages, [
                'readiness',
                jobType === 'shift_open' ? 'shift_request' : 'shift_close_request'
            ]);
        });
    }
});

test('shift mutation stage is recorded by provider callback before an uncertain failure', async t => {
    for (const jobType of ['shift_open', 'shift_close']) {
        await t.test(jobType, async () => {
            const stages = [];
            const expected = new Error(`${jobType}-after-boundary`);
            const methodName = jobType === 'shift_open' ? 'openShift' : 'closeShift';
            const provider = {
                async prepareMutation() {},
                async [methodName](input) {
                    await input.beforeExternalMutation();
                    throw expected;
                }
            };

            await assert.rejects(() => runShiftJob(provider, shiftContext(jobType, stages)), error => error === expected);
            assert.deepEqual(stages, [
                'readiness',
                jobType === 'shift_open' ? 'shift_request' : 'shift_close_request',
                jobType === 'shift_open'
                    ? 'shift_request_maybe_submitted'
                    : 'shift_close_request_maybe_submitted'
            ]);
        });
    }
});

test('sale stays at receipt_validation when provider fails before submit mutation callback', async () => {
    const stages = [];
    const expected = new Error('sale-before-boundary');
    const provider = {
        async prepareMutation() {},
        async validateSale(input) {
            await input.beforeExternalMutation();
        },
        async submitSaleReceipt() {
            throw expected;
        }
    };

    await assert.rejects(() => runReceiptSaleJob(provider, saleContext(stages)), error => error === expected);
    assert.deepEqual(stages, ['readiness', 'receipt_validation']);
});

test('sale records sale_submit only inside provider callback before an uncertain failure', async () => {
    const stages = [];
    const expected = new Error('sale-after-boundary');
    const provider = {
        async prepareMutation() {},
        async validateSale(input) {
            await input.beforeExternalMutation();
        },
        async submitSaleReceipt(input) {
            await input.beforeExternalMutation();
            throw expected;
        }
    };

    await assert.rejects(() => runReceiptSaleJob(provider, saleContext(stages)), error => error === expected);
    assert.deepEqual(stages, ['readiness', 'receipt_validation', 'sale_submit']);
});

test('service receipt stays pre-submit when provider fails before its mutation callback', async () => {
    const stages = [];
    const expected = new Error('service-before-boundary');
    const provider = {
        async createServiceReceipt() {
            throw expected;
        }
    };

    await assert.rejects(() => runServiceReceiptJob(provider, serviceContext(stages)), error => error === expected);
    assert.deepEqual(stages, ['readiness']);
});

test('service receipt records service_submit before an uncertain provider failure', async () => {
    const stages = [];
    const expected = new Error('service-after-boundary');
    const provider = {
        async createServiceReceipt(input) {
            await input.beforeExternalMutation();
            throw expected;
        }
    };

    await assert.rejects(() => runServiceReceiptJob(provider, serviceContext(stages)), error => error === expected);
    assert.deepEqual(stages, ['readiness', 'service_submit']);
});

test('return receipt records return_submit only inside the provider mutation boundary', async () => {
    const beforeStages = [];
    const beforeError = new Error('return-before-boundary');
    await assert.rejects(
        () => runReceiptReturnJob({
            async createReturnReceipt() { throw beforeError; }
        }, returnContext(beforeStages)),
        error => error === beforeError
    );
    assert.deepEqual(beforeStages, ['readiness']);

    const afterStages = [];
    const afterError = new Error('return-after-boundary');
    await assert.rejects(
        () => runReceiptReturnJob({
            async createReturnReceipt(input) {
                await input.beforeExternalMutation();
                throw afterError;
            }
        }, returnContext(afterStages)),
        error => error === afterError
    );
    assert.deepEqual(afterStages, ['readiness', 'return_submit']);
});

test('possibly submitted return retries by same-UUID lookup and never by a second POST', async () => {
    const stages = [];
    const calls = [];
    const context = returnContext(stages, {
        external_stage: 'return_submit',
        payload: { external_stage: 'return_submit' },
        fiscal_operation_external_stage: 'return_submit',
        fiscal_operation_status: 'unknown',
        attempts: 2
    });
    const result = await runReceiptReturnJob({
        async lookupReceipt(input) {
            calls.push({ method: 'lookupReceipt', providerOperationId: input.providerOperationId });
            return { found: true, receipt: { id: input.providerOperationId, status: 'DONE' } };
        },
        async createReturnReceipt() {
            calls.push({ method: 'createReturnReceipt' });
        }
    }, context);

    assert.equal(result.source, 'lookup');
    assert.deepEqual(stages, ['return_lookup']);
    assert.deepEqual(calls, [{ method: 'lookupReceipt', providerOperationId: context.job.provider_operation_id }]);
});

test('return retry with durable pre-mutation stage may submit only its original UUID', async () => {
    const stages = [];
    const context = returnContext(stages, {
        fiscal_operation_status: 'failed',
        attempts: 4
    });
    let submittedUuid = null;
    const result = await runReceiptReturnJob({
        async createReturnReceipt(input) {
            submittedUuid = input.fiscalOperation.provider_operation_id;
            await input.beforeExternalMutation();
            return { id: submittedUuid, status: 'DONE' };
        }
    }, context);

    assert.equal(result.source, 'return');
    assert.equal(submittedUuid, context.job.provider_operation_id);
    assert.deepEqual(stages, ['readiness', 'return_submit']);
});

test('possibly submitted service receipt retries through same-UUID lookup only', async () => {
    const stages = [];
    const calls = [];
    const context = serviceContext(stages, {
        external_stage: 'service_submit',
        payload: { external_stage: 'service_submit' },
        fiscal_operation_external_stage: 'service_submit',
        fiscal_operation_status: 'unknown',
        attempts: 2
    });
    const provider = {
        async lookupReceipt(input) {
            calls.push({ method: 'lookupReceipt', providerOperationId: input.providerOperationId });
            return { found: true, receipt: { id: input.providerOperationId, status: 'DONE' } };
        },
        async createServiceReceipt() {
            calls.push({ method: 'createServiceReceipt' });
        }
    };

    const result = await runServiceReceiptJob(provider, context);

    assert.equal(result.source, 'service_lookup');
    assert.deepEqual(stages, ['service_lookup']);
    assert.deepEqual(calls, [{ method: 'lookupReceipt', providerOperationId: context.job.provider_operation_id }]);
});

test('retry with durable proof of pre-mutation failure may submit the original service UUID', async () => {
    const stages = [];
    const context = serviceContext(stages, { attempts: 2, fiscal_operation_status: 'failed' });
    let createCalls = 0;
    const provider = {
        async createServiceReceipt(input) {
            createCalls += 1;
            await input.beforeExternalMutation();
            return { id: context.job.provider_operation_id, status: 'DONE' };
        }
    };

    const result = await runServiceReceiptJob(provider, context);

    assert.equal(result.source, 'service_submit');
    assert.equal(createCalls, 1);
    assert.deepEqual(stages, ['readiness', 'service_submit']);
});

test('ambiguous legacy service retry without a durable pre-mutation stage is lookup-only', async () => {
    const stages = [];
    const context = serviceContext(stages, {
        external_stage: null,
        payload: {},
        fiscal_operation_external_stage: null,
        fiscal_request_snapshot: {},
        fiscal_operation_status: 'unknown',
        attempts: 2
    });
    let createCalls = 0;
    const provider = {
        async lookupReceipt() {
            return { found: false };
        },
        async createServiceReceipt() {
            createCalls += 1;
        }
    };

    await assert.rejects(
        () => runServiceReceiptJob(provider, context),
        error => error.code === 'service_receipt_lookup_pending' && error.unknown === true
    );
    assert.equal(createCalls, 0);
    assert.deepEqual(stages, ['service_lookup']);
});

test('conflicting durable sale stages converge to lookup-only', async () => {
    assert.equal(externalStage({
        job_type: 'receipt_sell',
        external_stage: 'auth',
        payload: { external_stage: 'auth' },
        fiscal_operation_external_stage: 'sale_submit',
        fiscal_request_snapshot: { external_stage: 'auth' }
    }), 'receipt_lookup');

    const stages = [];
    const calls = [];
    const context = saleContext(stages);
    context.job.external_stage = 'auth';
    context.job.payload = { external_stage: 'auth' };
    context.job.fiscal_operation_external_stage = 'sale_submit';
    const provider = {
        async lookupReceipt(input) {
            calls.push({ method: 'lookupReceipt', providerOperationId: input.providerOperationId });
            return { found: true, receipt: { id: input.providerOperationId, status: 'DONE' } };
        },
        async prepareMutation() {
            calls.push({ method: 'prepareMutation' });
        },
        async validateSale() {
            calls.push({ method: 'validateSale' });
        },
        async submitSaleReceipt() {
            calls.push({ method: 'submitSaleReceipt' });
        }
    };

    const result = await runReceiptSaleJob(provider, context);

    assert.equal(result.source, 'lookup');
    assert.deepEqual(stages, ['receipt_lookup']);
    assert.deepEqual(calls, [{ method: 'lookupReceipt', providerOperationId: context.job.provider_operation_id }]);
});

test('conflicting durable service stages converge to lookup-only', () => {
    assert.equal(externalStage({
        job_type: 'service_receipt',
        external_stage: 'auth',
        payload: { external_stage: 'service_submit' },
        fiscal_operation_external_stage: 'auth',
        fiscal_request_snapshot: { external_stage: 'auth' }
    }), 'service_lookup');
});

test('conflicting durable shift stages converge to lookup instead of a second mutation', () => {
    assert.equal(externalStage({
        job_type: 'shift_open',
        external_stage: 'auth',
        payload: { external_stage: 'auth' },
        fiscal_operation_external_stage: 'shift_request_maybe_submitted',
        fiscal_request_snapshot: { external_stage: 'auth' }
    }), 'shift_lookup');
    assert.equal(externalStage({
        job_type: 'shift_close',
        external_stage: 'readiness',
        payload: { external_stage: 'shift_close_request_maybe_submitted' },
        fiscal_operation_external_stage: 'shift_close_lookup',
        fiscal_request_snapshot: { external_stage: 'auth' }
    }), 'shift_close_lookup');
});

test('job claiming honors post-submit evidence from every durable stage source', async () => {
    let claimSql = '';
    let claimParams = [];
    const client = {
        async query(sql, params) {
            claimSql = sql;
            claimParams = params;
            return { rows: [] };
        }
    };

    await claimPaymentOutboxJobs(client, {
        lockedBy: 'test-worker',
        cashierProEnabled: false,
        eligibleRuntimeContexts: [{
            fiscalProfileId: 10,
            fiscalRegisterId: 20,
            registerCredentialRef: 'park-middle-register',
            cashierCredentialRef: 'park-middle-cashier'
        }]
    });

    assert.match(claimSql, /NULLIF\(job\.external_stage, ''\) IN \('sale_submit', 'receipt_lookup', 'complete'\)/);
    assert.match(claimSql, /NULLIF\(job\.payload->>'external_stage', ''\) IN \('sale_submit', 'receipt_lookup', 'complete'\)/);
    assert.match(claimSql, /NULLIF\(fo\.external_stage, ''\) IN \('sale_submit', 'receipt_lookup', 'complete'\)/);
    assert.match(claimSql, /NULLIF\(fo\.request_snapshot->>'external_stage', ''\) IN \('sale_submit', 'receipt_lookup', 'complete'\)/);
    assert.match(claimSql, /fo\.register_credential_ref = fr\.provider_license_ref/);
    assert.match(claimSql, /fo\.cashier_credential_ref = fcb\.provider_cashier_login_ref/);
    assert.match(
        claimSql,
        /WHEN job\.job_type IN \('receipt_sell', 'receipt_status_lookup', 'receipt_validate'\)[\s\S]*THEN COALESCE\(po\.cashier_user_id, fo\.initiated_by_user_id\)[\s\S]*ELSE fo\.initiated_by_user_id/,
        'non-sale jobs must resolve the binding of the operation initiator rather than the original order cashier'
    );
    assert.match(claimSql, /jsonb_to_recordset\(\$6::jsonb\)/);
    assert.deepEqual(JSON.parse(claimParams[5]), [{
        fiscal_profile_id: 10,
        fiscal_register_id: 20,
        register_credential_ref: 'park-middle-register',
        cashier_credential_ref: 'park-middle-cashier'
    }]);
});

test('worker accepts only a complete immutable provider context that still matches current mapping', () => {
    assert.doesNotThrow(() => assertImmutableProviderContext(immutableProviderContext()));
});

test('worker rejects a missing immutable provider context before provider construction', () => {
    const context = immutableProviderContext({
        job: {
            fiscal_configuration_hash: null,
            fiscal_request_snapshot: {}
        }
    });
    assert.throws(
        () => assertImmutableProviderContext(context),
        error => error.code === 'fiscal_provider_context_snapshot_incomplete'
            && error.retryable === false
            && error.details.missing.includes('fiscal_configuration_hash')
            && error.details.missing.includes('request_snapshot.provider_context')
    );
});

test('worker rejects immutable snapshot mismatch, mapping drift and optional outlet drift', () => {
    const snapshotMismatch = immutableProviderContext();
    snapshotMismatch.job.provider_cashier_id = 'different-cashier';
    assert.throws(
        () => assertImmutableProviderContext(snapshotMismatch),
        error => error.code === 'fiscal_provider_context_snapshot_mismatch'
    );

    const mappingDrift = immutableProviderContext({ job: { current_provider_register_id: 'rotated-register' } });
    assert.throws(
        () => assertImmutableProviderContext(mappingDrift),
        error => error.code === 'fiscal_provider_context_drift'
    );

    const outletDrift = immutableProviderContext({ job: { current_provider_outlet_id: 'new-outlet' } });
    assert.throws(
        () => assertImmutableProviderContext(outletDrift),
        error => error.code === 'fiscal_provider_context_drift' && error.details.field === 'provider_outlet_id'
    );
});

test('worker rejects a modified provider context whose stored hash was not recomputed', () => {
    const context = immutableProviderContext();
    context.job.fiscal_request_snapshot.provider_context.provider_register_id = 'tampered-register';
    assert.throws(
        () => assertImmutableProviderContext(context),
        error => error.code === 'fiscal_configuration_hash_mismatch'
    );
});

test('EventBus SQL failure rolls back only its savepoint and preserves the fiscal transaction', async () => {
    const queries = [];
    const client = {
        async query(sql) {
            queries.push(sql);
            return { rows: [] };
        }
    };

    await safePublishFiscalEvent(
        client,
        'fiscal.receipt_succeeded',
        { fiscalOperationId: 41 },
        'fiscal_operation',
        '41',
        'fiscal.receipt_succeeded:41',
        async () => {
            throw new Error('simulated outbox insert failure');
        }
    );

    assert.deepEqual(queries, [
        'SAVEPOINT payment_outbox_event_publish',
        'ROLLBACK TO SAVEPOINT payment_outbox_event_publish',
        'RELEASE SAVEPOINT payment_outbox_event_publish'
    ]);
});

test('EventBus savepoint recovery failure aborts the fiscal transaction instead of reporting false success', async () => {
    const client = {
        async query(sql) {
            if (sql === 'ROLLBACK TO SAVEPOINT payment_outbox_event_publish') {
                throw new Error('simulated connection failure');
            }
            return { rows: [] };
        }
    };

    await assert.rejects(
        safePublishFiscalEvent(
            client,
            'fiscal.receipt_failed',
            { fiscalOperationId: 42 },
            'fiscal_operation',
            '42',
            'fiscal.receipt_failed:42',
            async () => {
                throw new Error('simulated outbox insert failure');
            }
        ),
        /simulated connection failure/
    );
});

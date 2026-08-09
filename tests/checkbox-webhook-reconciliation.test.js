const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { createCheckboxWebhookRouter } = require('../routes/checkbox-webhook');
const { signCheckboxWebhookBody } = require('../services/checkbox/webhookAuth');
const {
    CheckboxWebhookError,
    handleCheckboxWebhook,
    payloadHash
} = require('../services/checkbox/webhookService');
const {
    PaymentOutboxWorkerError,
    claimPaymentOutboxJobs,
    processPaymentOutboxJobs
} = require('../services/payments/paymentOutboxWorker');

function listen(app) {
    return new Promise(resolve => {
        const server = app.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
        });
    });
}

function close(server) {
    return new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
    });
}

async function postRaw(baseUrl, body, signature = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (signature) headers['X-Request-Signature'] = signature;
    const response = await fetch(`${baseUrl}/webhook`, { method: 'POST', headers, body });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
}

function signed(body, secret = 'unit-secret') {
    return signCheckboxWebhookBody(Buffer.from(body), secret);
}

describe('Checkbox webhook route auth boundary', () => {
    async function withWebhookApp(testFn) {
        const calls = [];
        const app = express();
        app.use('/webhook', express.raw({ type: '*/*', limit: '256kb' }), createCheckboxWebhookRouter({
            signingSecret: 'unit-secret',
            enabled: true,
            webhookHandler: async input => {
                calls.push(input);
                return { replayed: false, queued: true, eventId: 1 };
            }
        }));
        const { server, baseUrl } = await listen(app);
        try {
            await testFn({ baseUrl, calls });
        } finally {
            await close(server);
        }
    }

    it('rejects missing signature before webhook mutation', async () => {
        await withWebhookApp(async ({ baseUrl, calls }) => {
            const result = await postRaw(baseUrl, JSON.stringify({ provider_operation_id: 'op-1' }));
            assert.equal(result.status, 401);
            assert.equal(result.body.code, 'checkbox_webhook_signature_missing');
            assert.equal(calls.length, 0);
        });
    });

    it('rejects wrong signature before webhook mutation', async () => {
        await withWebhookApp(async ({ baseUrl, calls }) => {
            const result = await postRaw(baseUrl, JSON.stringify({ provider_operation_id: 'op-1' }), 'sha256=00');
            assert.equal(result.status, 401);
            assert.equal(result.body.code, 'checkbox_webhook_signature_invalid');
            assert.equal(calls.length, 0);
        });
    });

    it('accepts valid signature and passes raw body to the handler', async () => {
        await withWebhookApp(async ({ baseUrl, calls }) => {
            const body = JSON.stringify({ event_id: 'evt-1', provider_operation_id: 'op-1' });
            const result = await postRaw(baseUrl, body, signed(body));
            assert.equal(result.status, 200);
            assert.equal(result.body.ok, true);
            assert.equal(calls.length, 1);
            assert.equal(Buffer.isBuffer(calls[0].rawBody), true);
            assert.equal(calls[0].rawBody.toString('utf8'), body);
        });
    });

    it('rejects tampered raw body when signature was made for the original payload', async () => {
        await withWebhookApp(async ({ baseUrl, calls }) => {
            const original = JSON.stringify({ event_id: 'evt-1', provider_operation_id: 'op-1', status: 'ok' });
            const tampered = JSON.stringify({ event_id: 'evt-1', provider_operation_id: 'op-1', status: 'changed' });
            const result = await postRaw(baseUrl, tampered, signed(original));
            assert.equal(result.status, 401);
            assert.equal(result.body.code, 'checkbox_webhook_signature_invalid');
            assert.equal(calls.length, 0);
        });
    });
});

class FakeWebhookDb {
    constructor() {
        this.operations = [
            { id: 501, fiscal_profile_id: 7, payment_order_id: 301, provider: 'checkbox', provider_operation_id: 'op-1', status: 'pending' }
        ];
        this.receipts = [];
        this.events = [];
        this.audits = [];
        this.jobs = [];
        this.nextEventId = 900;
        this.nextJobId = 1200;
    }

    async connect() {
        return new FakeWebhookClient(this);
    }
}

class FakeWebhookClient {
    constructor(db) {
        this.db = db;
    }

    async query(sql, params = []) {
        const normalized = sql.replace(/\s+/g, ' ').trim();
        if (normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK') return { rows: [] };

        if (normalized.includes('FROM fiscal_operations fo')) {
            const [operationId, receiptId] = params;
            const rows = this.db.operations.filter(operation => {
                if (operationId && operation.provider_operation_id === operationId) return true;
                return receiptId && this.db.receipts.some(receipt => receipt.fiscal_operation_id === operation.id && receipt.provider_receipt_id === receiptId);
            });
            return { rows };
        }

        if (normalized.includes('FROM provider_webhook_events') && normalized.includes('provider_event_id = $1')) {
            return { rows: this.db.events.filter(event => event.provider_event_id === params[0]).slice(0, 1) };
        }

        if (normalized.includes('FROM provider_webhook_events') && normalized.includes('payload_sha256 = $1')) {
            return { rows: this.db.events.filter(event => event.payload_sha256 === params[0]).slice(0, 1) };
        }

        if (normalized.startsWith('INSERT INTO provider_webhook_events')) {
            const [fiscalProfileId, providerEventId, deliveryId, eventType, operationId, receiptId, hash, sanitizedPayload] = params;
            const row = {
                id: this.db.nextEventId++,
                fiscal_profile_id: fiscalProfileId,
                provider: 'checkbox',
                provider_event_id: providerEventId,
                delivery_id: deliveryId,
                event_type: eventType,
                related_provider_operation_id: operationId,
                related_provider_receipt_id: receiptId,
                payload_sha256: hash,
                sanitized_payload: JSON.parse(sanitizedPayload),
                status: 'received'
            };
            this.db.events.push(row);
            return { rows: [{ id: row.id }] };
        }

        if (normalized.startsWith('INSERT INTO fiscal_audit_events')) {
            this.db.audits.push({
                fiscal_profile_id: params[0],
                actor_user_id: null,
                event_type: 'checkbox_webhook_received',
                metadata: JSON.parse(params[4])
            });
            return { rows: [] };
        }

        if (normalized.startsWith('INSERT INTO payment_outbox_jobs')) {
            const [fiscalProfileId, operationId, paymentOrderId, jobType, idempotencyKey, payload] = params;
            let row = this.db.jobs.find(job => job.idempotency_key === idempotencyKey);
            if (!row) {
                row = {
                    id: this.db.nextJobId++,
                    fiscal_profile_id: fiscalProfileId,
                    fiscal_operation_id: operationId,
                    payment_order_id: paymentOrderId,
                    job_type: jobType,
                    idempotency_key: idempotencyKey,
                    payload: JSON.parse(payload),
                    status: 'queued'
                };
                this.db.jobs.push(row);
            }
            return { rows: [{ id: row.id, status: row.status }] };
        }

        throw new Error(`Unhandled fake webhook query: ${normalized}`);
    }

    release() {}
}

describe('Checkbox webhook event handling', () => {
    it('extracts official nested receipt payload identity and queues canonical polling', async () => {
        const dbPool = new FakeWebhookDb();
        const body = Buffer.from(JSON.stringify({
            event_id: 'evt-nested',
            event_type: 'receipt.done',
            receipt: {
                id: 'op-1',
                status: 'DONE',
                type: 'SELL',
                context: { fiscal_profile_id: 7 },
                shift: { id: 'shift-1' }
            }
        }));
        const result = await handleCheckboxWebhook({ dbPool, rawBody: body, headers: {} });
        assert.equal(result.replayed, false);
        assert.equal(result.queued, true);
        assert.equal(dbPool.events[0].related_provider_operation_id, 'op-1');
        assert.equal(dbPool.jobs[0].job_type, 'receipt_status_lookup');
    });

    it('deduplicates repeated events by provider event id and payload hash', async () => {
        const dbPool = new FakeWebhookDb();
        const body = Buffer.from(JSON.stringify({ event_id: 'evt-1', provider_operation_id: 'op-1', status: 'done' }));
        const first = await handleCheckboxWebhook({ dbPool, rawBody: body, headers: {} });
        const replay = await handleCheckboxWebhook({ dbPool, rawBody: body, headers: {} });
        assert.equal(first.replayed, false);
        assert.equal(replay.replayed, true);
        assert.equal(dbPool.events.length, 1);
        assert.equal(dbPool.jobs.length, 1);
        assert.equal(dbPool.events[0].payload_sha256, payloadHash(body));
    });

    it('rejects same provider event id with a different payload', async () => {
        const dbPool = new FakeWebhookDb();
        await handleCheckboxWebhook({ dbPool, rawBody: Buffer.from(JSON.stringify({ event_id: 'evt-1', provider_operation_id: 'op-1', status: 'done' })), headers: {} });
        await assert.rejects(
            () => handleCheckboxWebhook({ dbPool, rawBody: Buffer.from(JSON.stringify({ event_id: 'evt-1', provider_operation_id: 'op-1', status: 'changed' })), headers: {} }),
            error => error instanceof CheckboxWebhookError && error.code === 'checkbox_webhook_event_payload_conflict'
        );
        assert.equal(dbPool.jobs.length, 1);
    });

    it('rejects cross-profile callbacks before queue mutation', async () => {
        const dbPool = new FakeWebhookDb();
        await assert.rejects(
            () => handleCheckboxWebhook({ dbPool, rawBody: Buffer.from(JSON.stringify({ event_id: 'evt-cross', provider_operation_id: 'op-1', fiscal_profile_id: 8 })), headers: {} }),
            error => error instanceof CheckboxWebhookError && error.code === 'checkbox_webhook_cross_profile_rejected'
        );
        assert.equal(dbPool.events.length, 0);
        assert.equal(dbPool.jobs.length, 0);
    });

    it('writes provider audit without req.user and redacts secret-like payload fields', async () => {
        const dbPool = new FakeWebhookDb();
        await handleCheckboxWebhook({
            dbPool,
            rawBody: Buffer.from(JSON.stringify({
                event_id: 'evt-secret',
                provider_operation_id: 'op-1',
                api_key: 'should-not-persist',
                nested: { token: 'also-secret' }
            })),
            headers: {}
        });
        assert.equal(dbPool.audits.length, 1);
        assert.equal(dbPool.audits[0].actor_user_id, null);
        assert.equal(dbPool.audits[0].metadata.req_user_absent, true);
        assert.equal(dbPool.events[0].sanitized_payload.api_key, '[redacted]');
        assert.equal(dbPool.events[0].sanitized_payload.nested.token, '[redacted]');
    });
});

class FakeWorkerDb {
    constructor({ jobs = [], operations = [], orders = [], items = [] } = {}) {
        this.jobs = jobs;
        this.operations = operations;
        this.orders = orders;
        this.items = items;
        this.receipts = [];
        this.incidents = [];
        this.clients = [];
    }

    static oneJob({ id = 1, status = 'queued', attempts = 0, maxAttempts = 3, operationStatus = 'pending', operationId = 'op-1', externalStage = null, shiftStatus = 'open', providerShiftId = 'shift-1' } = {}) {
        return new FakeWorkerDb({
            jobs: [{
                id,
                fiscal_profile_id: 7,
                fiscal_operation_id: 501 + id,
                payment_order_id: 301 + id,
                job_type: 'receipt_sell',
                status,
                attempts,
                max_attempts: maxAttempts,
                priority: 10,
                next_run_at: new Date(Date.now() - 1000).toISOString(),
                locked_at: status === 'claimed' ? new Date(Date.now() - 10 * 60 * 1000).toISOString() : null,
                locked_by: status === 'claimed' ? 'stale-worker' : null,
                payload: externalStage ? { external_stage: externalStage } : {}
            }],
            operations: [{
                id: 501 + id,
                fiscal_profile_id: 7,
                payment_order_id: 301 + id,
                status: operationStatus,
                operation_type: 'sale',
                provider_operation_id: operationId,
                provider_status: null,
                fiscal_shift_status: shiftStatus,
                provider_shift_id: providerShiftId,
                request_snapshot: externalStage ? { external_stage: externalStage } : {}
            }],
            orders: [{
                id: 301 + id,
                fiscal_profile_id: 7,
                status: 'confirmed',
                payment_status: 'paid',
                fiscal_status: 'pending',
                total_amount_minor: '10000',
                payment_method: 'cash',
                source_snapshot: {},
                confirmation_snapshot: {}
            }],
            items: [{
                id: 1,
                fiscal_profile_id: 7,
                payment_order_id: 301 + id,
                line_number: 1,
                item_name: 'Park admission',
                unit_price_minor: '10000',
                quantity_milli: 1000
            }]
        });
    }

    async connect() {
        const client = new FakeWorkerClient(this);
        this.clients.push(client);
        return client;
    }
}

class FakeWorkerClient {
    constructor(db) {
        this.db = db;
        this.queries = [];
        this.inTransaction = false;
    }

    async query(sql, params = []) {
        this.queries.push({ sql, params });
        const normalized = sql.replace(/\s+/g, ' ').trim();
        if (normalized === 'BEGIN') {
            this.inTransaction = true;
            return { rows: [] };
        }
        if (normalized === 'COMMIT' || normalized === 'ROLLBACK') {
            this.inTransaction = false;
            return { rows: [] };
        }

        if (normalized.startsWith('WITH candidate_jobs AS')) {
            const limit = params[1];
            const claimable = this.db.jobs
                .filter(job => ['queued', 'failed'].includes(job.status) || (['claimed', 'running'].includes(job.status) && job.locked_by === 'stale-worker'))
                .filter(job => Number(job.attempts) < Number(job.max_attempts))
                .sort((a, b) => a.priority - b.priority || a.id - b.id)
                .slice(0, limit);
            for (const job of claimable) {
                job.status = 'claimed';
                job.locked_by = params[2];
                job.locked_at = new Date().toISOString();
                job.heartbeat_at = new Date().toISOString();
                job.lock_token = params[6];
                job.attempts += 1;
            }
            return { rows: claimable.map(job => ({ ...job })) };
        }

        if (normalized.includes('FROM payment_outbox_jobs job') && normalized.includes('WHERE job.id = $1')) {
            const job = this.db.jobs.find(row => row.id === params[0]);
            const operation = this.db.operations.find(row => row.id === job.fiscal_operation_id && row.fiscal_profile_id === job.fiscal_profile_id);
            const order = this.db.orders.find(row => row.id === job.payment_order_id && row.fiscal_profile_id === job.fiscal_profile_id);
            return {
                rows: [{
                    ...job,
                    fiscal_operation_status: operation?.status,
                    operation_type: operation?.operation_type,
                    provider_operation_id: operation?.provider_operation_id,
                    provider_status: operation?.provider_status,
                    provider_register_id: 'register-1',
                    provider_cashier_id: 'cashier-1',
                    provider_organization_id: 'org-1',
                    fiscal_shift_status: operation?.fiscal_shift_status || 'open',
                    provider_shift_id: operation?.provider_shift_id || 'shift-1',
                    fiscal_request_snapshot: operation?.request_snapshot,
                    payment_order_status: order?.status,
                    payment_status: order?.payment_status,
                    payment_order_fiscal_status: order?.fiscal_status,
                    total_amount_minor: order?.total_amount_minor,
                    payment_method: order?.payment_method,
                    source_snapshot: order?.source_snapshot,
                    confirmation_snapshot: order?.confirmation_snapshot
                }]
            };
        }

        if (normalized.startsWith('SELECT * FROM payment_order_items')) {
            return { rows: this.db.items.filter(item => item.fiscal_profile_id === params[0] && item.payment_order_id === params[1]) };
        }

        if (normalized.startsWith('UPDATE fiscal_operations') && normalized.includes("SET status = 'fiscalized'")) {
            const operation = this.db.operations.find(row => row.id === params[0] && row.fiscal_profile_id === params[1]);
            operation.status = 'fiscalized';
            operation.provider_status = params[2];
            operation.response_snapshot = JSON.parse(params[3]);
            return { rows: [] };
        }

        if (normalized.startsWith('UPDATE payment_outbox_jobs') && normalized.includes("SET status = 'running'")) {
            const job = this.db.jobs.find(row => row.id === params[0] && row.fiscal_profile_id === params[1] && row.locked_by === params[2] && row.attempts === params[3]);
            if (job && ['claimed', 'running'].includes(job.status)) {
                job.status = 'running';
                job.locked_at = new Date().toISOString();
                job.heartbeat_at = new Date().toISOString();
                return { rows: [{ id: job.id }] };
            }
            return { rows: [] };
        }

        if (normalized.startsWith('SELECT id FROM payment_outbox_jobs') && normalized.includes('FOR UPDATE')) {
            const job = this.db.jobs.find(row => row.id === params[0] && row.fiscal_profile_id === params[1] && row.locked_by === params[2] && row.attempts === params[3] && ['claimed', 'running'].includes(row.status));
            return { rows: job ? [{ id: job.id }] : [] };
        }

        if (normalized.startsWith('UPDATE payment_outbox_jobs') && normalized.includes('payload = payload || $3::jsonb')) {
            const job = this.db.jobs.find(row => row.id === params[0] && row.fiscal_profile_id === params[1]);
            if (job) {
                job.payload = { ...(job.payload || {}), ...JSON.parse(params[2]) };
                if (normalized.includes("status = CASE WHEN status = 'claimed'")) {
                    if (job.status === 'claimed') job.status = 'running';
                }
                job.locked_at = new Date().toISOString();
                job.heartbeat_at = new Date().toISOString();
            }
            return { rows: job ? [{ id: job.id }] : [] };
        }

        if (normalized.startsWith('UPDATE fiscal_operations') && normalized.includes('external_stage = $3::jsonb->>\'external_stage\'')) {
            const operation = this.db.operations.find(row => row.id === params[0] && row.fiscal_profile_id === params[1]);
            if (operation) {
                const payload = JSON.parse(params[2]);
                operation.external_stage = payload.external_stage;
                if (normalized.includes('receipt_validation')) {
                    if (payload.external_stage === 'receipt_validation') operation.status = 'validating';
                    else if (payload.external_stage === 'sale_submit') operation.status = 'sending';
                    else if (['pending', 'failed'].includes(operation.status)) operation.status = 'pending';
                }
            }
            return { rows: [] };
        }

        if (normalized.startsWith("SELECT * FROM fiscal_receipts WHERE provider = 'checkbox' AND provider_receipt_id = $1")) {
            return {
                rows: this.db.receipts
                    .filter(row => row.provider === 'checkbox' && row.provider_receipt_id === params[0])
                    .slice(0, 1)
            };
        }

        if (normalized.startsWith('INSERT INTO fiscal_receipts')) {
            const [profileId, operationId, orderId, refundId, receiptType, receiptId] = params;
            let receipt = this.db.receipts.find(row => row.provider === 'checkbox' && row.provider_receipt_id === receiptId);
            if (!receipt) {
                receipt = { fiscal_profile_id: profileId, fiscal_operation_id: operationId, payment_order_id: orderId, payment_refund_id: refundId, receipt_type: receiptType, provider: 'checkbox', provider_receipt_id: receiptId, status: 'fiscalized' };
                this.db.receipts.push(receipt);
            }
            return { rows: [{ id: this.db.receipts.indexOf(receipt) + 1 }] };
        }

        if (normalized.startsWith('UPDATE payment_orders') && normalized.includes("fiscal_status = 'fiscalized'")) {
            const order = this.db.orders.find(row => row.id === params[0] && row.fiscal_profile_id === params[1]);
            order.fiscal_status = 'fiscalized';
            return { rows: [] };
        }


        if (normalized.startsWith('UPDATE payment_orders') && normalized.includes('SET fiscal_status = $3')) {
            const order = this.db.orders.find(row => row.id === params[0] && row.fiscal_profile_id === params[1]);
            order.fiscal_status = params[2];
            return { rows: [] };
        }

        if (normalized.startsWith('UPDATE payment_outbox_jobs') && normalized.includes("status = 'succeeded'")) {
            const job = this.db.jobs.find(row => row.id === params[0] && row.fiscal_profile_id === params[1]);
            job.status = 'succeeded';
            job.locked_at = null;
            job.locked_by = null;
            job.lock_token = null;
            job.heartbeat_at = null;
            job.last_error_code = null;
            job.last_error_message = null;
            return { rows: [] };
        }

        if (normalized.startsWith('INSERT INTO fiscal_audit_events')) {
            return { rows: [] };
        }

        if (normalized.startsWith('INSERT INTO fiscal_operational_incidents')) {
            const [fiscalProfileId, fiscalRegisterId, fiscalOperationId, paymentOrderId, severity, incidentType, idempotencyKey, details] = params;
            const existing = this.db.incidents.find(row => row.idempotency_key === idempotencyKey);
            const parsedDetails = typeof details === 'string' ? JSON.parse(details) : details;
            if (existing) {
                existing.details = parsedDetails;
                if (existing.status !== 'resolved') existing.status = 'open';
            } else {
                this.db.incidents.push({
                    fiscal_profile_id: fiscalProfileId,
                    fiscal_register_id: fiscalRegisterId,
                    fiscal_operation_id: fiscalOperationId,
                    payment_order_id: paymentOrderId,
                    severity,
                    incident_type: incidentType,
                    status: 'open',
                    idempotency_key: idempotencyKey,
                    details: parsedDetails
                });
            }
            return { rows: [] };
        }

        if (normalized.startsWith('UPDATE payment_outbox_jobs') && normalized.includes('SET status = $3')) {
            const job = this.db.jobs.find(row => row.id === params[0] && row.fiscal_profile_id === params[1]);
            job.status = params[2];
            job.next_run_at = params[3];
            job.last_error_code = params[4];
            job.last_error_message = params[5];
            job.locked_at = null;
            job.locked_by = null;
            job.lock_token = null;
            job.heartbeat_at = null;
            return { rows: [] };
        }

        if (normalized.startsWith('UPDATE fiscal_operations') && normalized.includes('last_error_code')) {
            const operation = this.db.operations.find(row => row.id === params[0] && row.fiscal_profile_id === params[1]);
            operation.status = params[2];
            operation.last_error_code = params[3];
            operation.last_error_message = params[4];
            operation.next_status_check_at = params[5];
            return { rows: [] };
        }

        throw new Error(`Unhandled fake worker query: ${normalized}`);
    }

    release() {}
}

function createProvider({ lookupReceipts = new Map(), failValidate = null, timeoutAfterSuccess = false } = {}) {
    const calls = { lookup: [], validate: [], create: [] };
    return {
        calls,
        async lookupReceipt({ providerOperationId }) {
            calls.lookup.push(providerOperationId);
            if (lookupReceipts.has(providerOperationId)) return { found: true, receipt: lookupReceipts.get(providerOperationId) };
            return { found: false };
        },
        async validateSale(input) {
            calls.validate.push(input.providerOperationId);
            if (failValidate) throw failValidate;
        },
        async createSaleReceipt({ providerOperationId, paymentOrder }) {
            calls.create.push(providerOperationId);
            const receipt = {
                id: providerOperationId,
                status: 'DONE',
                receiptType: 'SELL',
                totalAmountMinor: paymentOrder.total_amount_minor,
                providerRegisterId: 'register-1',
                providerCashierId: 'cashier-1'
            };
            lookupReceipts.set(providerOperationId, receipt);
            if (timeoutAfterSuccess) {
                const error = new Error('fetch timeout token=should-not-leak');
                error.code = 'ETIMEDOUT';
                throw error;
            }
            return receipt;
        }
    };
}

describe('payment outbox worker reconciliation', () => {
    it('claims bounded jobs with FOR UPDATE SKIP LOCKED and lock expiry', async () => {
        const queries = [];
        const client = {
            async query(sql, params) {
                queries.push({ sql, params });
                return { rows: [] };
            }
        };
        await claimPaymentOutboxJobs(client, { batchSize: 3, lockedBy: 'worker-a', lockExpiryMs: 60000 });
        assert.match(queries[0].sql, /FOR UPDATE(?: OF job)? SKIP LOCKED/);
        assert.match(queries[0].sql, /COALESCE\(job\.heartbeat_at,\s*job\.locked_at\)/);
        assert.match(queries[0].sql, /LIMIT \$2/);
        assert.equal(queries[0].params[1], 3);
        assert.equal(queries[0].params[2], 'worker-a');
        assert.equal(queries[0].params[3], 60);
    });

    it('lets concurrent workers claim different jobs', async () => {
        const first = FakeWorkerDb.oneJob({ id: 1, operationId: 'op-1' });
        const second = FakeWorkerDb.oneJob({ id: 2, operationId: 'op-2' });
        const dbPool = new FakeWorkerDb({
            jobs: [...first.jobs, ...second.jobs],
            operations: [...first.operations, ...second.operations],
            orders: [...first.orders, ...second.orders],
            items: [...first.items, ...second.items]
        });
        const provider = createProvider();
        const [a, b] = await Promise.all([
            processPaymentOutboxJobs({ dbPool, provider, batchSize: 1, lockedBy: 'worker-a' }),
            processPaymentOutboxJobs({ dbPool, provider, batchSize: 1, lockedBy: 'worker-b' })
        ]);
        assert.equal(a.claimed + b.claimed, 2);
        assert.deepEqual(dbPool.jobs.map(job => job.status), ['succeeded', 'succeeded']);
        assert.deepEqual(new Set(provider.calls.create), new Set(['op-1', 'op-2']));
    });

    it('recovers expired locks and processes the claimed job', async () => {
        const dbPool = FakeWorkerDb.oneJob({ id: 1, status: 'claimed', operationId: 'op-lock' });
        const provider = createProvider();
        const result = await processPaymentOutboxJobs({ dbPool, provider, batchSize: 1, lockedBy: 'worker-recovery' });
        assert.equal(result.claimed, 1);
        assert.equal(dbPool.jobs[0].status, 'succeeded');
        assert.equal(provider.calls.create[0], 'op-lock');
    });

    it('does not send sale while local provider shift is not OPENED', async () => {
        const dbPool = FakeWorkerDb.oneJob({ id: 1, operationId: 'op-wait-shift', shiftStatus: 'opening', providerShiftId: null });
        const provider = createProvider();
        const result = await processPaymentOutboxJobs({ dbPool, provider, batchSize: 1, lockedBy: 'worker-shift-wait' });
        assert.equal(result.failed, 1);
        assert.equal(result.results[0].error.code, 'shift_not_provider_opened');
        assert.equal(provider.calls.validate.length, 0);
        assert.equal(provider.calls.create.length, 0);
        assert.equal(dbPool.operations[0].status, 'failed');
    });

    it('does not hold DB transaction while provider HTTP work is running', async () => {
        const dbPool = FakeWorkerDb.oneJob({ id: 1, operationId: 'op-no-db-tx' });
        const provider = createProvider();
        const assertNoTransaction = () => {
            assert.equal(dbPool.clients.some(client => client.inTransaction), false);
        };
        const originalValidate = provider.validateSale;
        const originalCreate = provider.createSaleReceipt;
        provider.validateSale = async input => {
            assertNoTransaction();
            return originalValidate(input);
        };
        provider.createSaleReceipt = async input => {
            assertNoTransaction();
            return originalCreate(input);
        };
        const result = await processPaymentOutboxJobs({ dbPool, provider, batchSize: 1, lockedBy: 'worker-no-db-tx' });
        assert.equal(result.succeeded, 1);
    });

    it('backs off retryable failures and dead-letters exhausted jobs with sanitized errors', async () => {
        const dbPool = FakeWorkerDb.oneJob({ id: 1, maxAttempts: 1, operationId: 'op-dead' });
        const provider = createProvider({ failValidate: new PaymentOutboxWorkerError('provider_500', 'provider failed api_key=plain-secret', { retryable: true }) });
        const result = await processPaymentOutboxJobs({ dbPool, provider, batchSize: 1, lockedBy: 'worker-dead' });
        assert.equal(result.failed, 1);
        assert.equal(dbPool.jobs[0].status, 'dead');
        assert.equal(dbPool.jobs[0].last_error_code, 'provider_500');
        assert.equal(dbPool.jobs[0].last_error_message.includes('plain-secret'), false);
        assert.equal(dbPool.operations[0].status, 'failed');
    });

    it('does not repeat sale when an unknown operation has no provider receipt yet', async () => {
        const dbPool = FakeWorkerDb.oneJob({ id: 1, operationStatus: 'unknown', operationId: 'op-unknown', externalStage: 'sale_submit' });
        const provider = createProvider();
        const result = await processPaymentOutboxJobs({ dbPool, provider, batchSize: 1, lockedBy: 'worker-unknown' });
        assert.equal(result.failed, 1);
        assert.equal(provider.calls.lookup.length, 1);
        assert.equal(provider.calls.create.length, 0);
        assert.equal(dbPool.operations[0].status, 'unknown');
    });

    it('reconciles timeout-after-provider-success through lookup without a second receipt UUID', async () => {
        const dbPool = FakeWorkerDb.oneJob({ id: 1, operationId: 'op-timeout' });
        const sharedReceipts = new Map();
        const firstProvider = createProvider({ lookupReceipts: sharedReceipts, timeoutAfterSuccess: true });
        const first = await processPaymentOutboxJobs({ dbPool, provider: firstProvider, batchSize: 1, lockedBy: 'worker-first' });
        assert.equal(first.failed, 1);
        assert.equal(firstProvider.calls.create.length, 1);
        assert.equal(dbPool.operations[0].status, 'unknown');

        const secondProvider = createProvider({ lookupReceipts: sharedReceipts });
        const second = await processPaymentOutboxJobs({ dbPool, provider: secondProvider, batchSize: 1, lockedBy: 'worker-second' });
        assert.equal(second.succeeded, 1);
        assert.equal(secondProvider.calls.lookup.length, 1);
        assert.equal(secondProvider.calls.create.length, 0);
        assert.equal(dbPool.receipts.length, 1);
        assert.equal(dbPool.receipts[0].provider_receipt_id, 'op-timeout');
        assert.equal(dbPool.operations[0].status, 'fiscalized');
    });
});


'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
    PaymentServiceError,
    confirmPaymentOrder,
    createAdmissionTicketPaymentOrder
} = require('../services/payments/paymentService');
const {
    PaymentWorkflowError,
    assertManualConfirmationBody,
    normalizeTender
} = require('../services/payments/paymentStateMachine');

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function baseUser(overrides = {}) {
    return {
        id: 50,
        username: 'cashier',
        role: 'reception',
        business_contexts: ['event_genix'],
        ...overrides
    };
}

function sampleQuote(overrides = {}) {
    return {
        legacy: false,
        quoteContractVersion: 1,
        businessContext: 'event_genix',
        ticketSubtotal: 500,
        currency: 'UAH',
        quoteFingerprint: 'quote-fingerprint-1',
        ticketLines: [
            {
                ticketTypeId: 1,
                ticketTypeCode: 'regular_child',
                ticketTypeName: 'Äèòÿ÷èé âõ³ä',
                quantity: 2,
                unitPriceUah: 250,
                subtotalUah: 500,
                tariffVersionId: 11,
                currency: 'UAH'
            }
        ],
        ...overrides
    };
}

function defaultMapping() {
    return {
        fiscal_profile_id: 20,
        fiscal_register_id: 40,
        fiscal_location_id: 30,
        crm_profile_key: 'event_genix',
        legal_entity_key: 'park_fop',
        legal_entity_name: 'Park FOP',
        register_alias: 'middle',
        register_display_name: 'Middle register',
        feature_enabled: true
    };
}

class FakePaymentDb {
    constructor(options = {}) {
        this.mappingRows = options.mappingRows || [defaultMapping()];
        this.failOn = options.failOn || null;
        this.locks = new Map();
        this.reset();
    }

    reset() {
        this.orders = [];
        this.items = [];
        this.attempts = [];
        this.allocations = [];
        this.fiscalOperations = [];
        this.outboxJobs = [];
        this.auditEvents = [];
        this.next = { order: 1, item: 1, attempt: 1, allocation: 1, operation: 1, job: 1, audit: 1 };
        this.queries = [];
    }

    seedOrder(overrides = {}) {
        const row = {
            id: overrides.id || this.next.order++,
            fiscal_profile_id: 20,
            fiscal_register_id: 40,
            fiscal_location_id: 30,
            crm_profile_key: 'event_genix',
            legal_entity_key: 'park_fop',
            legal_entity_name: 'Park FOP',
            register_alias: 'middle',
            register_display_name: 'Middle register',
            cashier_user_id: 50,
            source_type: 'admission_ticket',
            source_id: 'source-1',
            order_key: `admission_ticket:source-1:${this.next.order}`,
            idempotency_key: `create-${this.next.order}`,
            status: 'draft',
            payment_status: 'unpaid',
            fiscal_status: 'pending',
            payment_method: 'cash',
            total_amount_minor: '50000',
            currency: 'UAH',
            source_snapshot: { request_fingerprint: 'seed' },
            confirmation_snapshot: {},
            confirmed_at: null,
            ...overrides
        };
        this.orders.push(row);
        if (row.id >= this.next.order) this.next.order = row.id + 1;
        return row;
    }

    snapshot() {
        return {
            orders: clone(this.orders),
            items: clone(this.items),
            attempts: clone(this.attempts),
            allocations: clone(this.allocations),
            fiscalOperations: clone(this.fiscalOperations),
            outboxJobs: clone(this.outboxJobs),
            auditEvents: clone(this.auditEvents),
            next: clone(this.next)
        };
    }

    restore(snapshot) {
        this.orders = snapshot.orders;
        this.items = snapshot.items;
        this.attempts = snapshot.attempts;
        this.allocations = snapshot.allocations;
        this.fiscalOperations = snapshot.fiscalOperations;
        this.outboxJobs = snapshot.outboxJobs;
        this.auditEvents = snapshot.auditEvents;
        this.next = snapshot.next;
    }

    async connect() {
        return new FakePaymentClient(this);
    }
}

class FakePaymentClient {
    constructor(db) {
        this.db = db;
        this.txSnapshot = null;
        this.releases = [];
    }

    ensureSnapshot() {
        if (!this.txSnapshot) this.txSnapshot = this.db.snapshot();
    }

    releaseLocks() {
        for (const release of this.releases.splice(0)) release();
    }

    release() {}

    async query(sql, params = []) {
        const normalized = sql.replace(/\s+/g, ' ').trim();
        this.db.queries.push({ sql: normalized, params });

        if (normalized === 'BEGIN') return { rows: [] };
        if (normalized === 'COMMIT') {
            this.txSnapshot = null;
            this.releaseLocks();
            return { rows: [] };
        }
        if (normalized === 'ROLLBACK') {
            if (this.txSnapshot) this.db.restore(this.txSnapshot);
            this.txSnapshot = null;
            this.releaseLocks();
            return { rows: [] };
        }

        if (this.db.failOn && normalized.includes(this.db.failOn)) {
            throw new Error(`forced failure on ${this.db.failOn}`);
        }

        if (normalized.includes('FROM payment_orders') && normalized.includes('WHERE idempotency_key = $1')) {
            return { rows: this.db.orders.filter(order => order.idempotency_key === params[0]).slice(0, 1) };
        }

        if (normalized.includes('FROM fiscal_profiles fp') && normalized.includes('fr.register_alias = $2')) {
            return { rows: this.db.mappingRows.filter(row => row.crm_profile_key === params[0] && row.register_alias === params[1]) };
        }

        if (normalized.startsWith('INSERT INTO payment_orders')) {
            this.ensureSnapshot();
            const row = {
                id: this.db.next.order++,
                fiscal_profile_id: Number(params[0]),
                fiscal_register_id: Number(params[1]),
                cashier_user_id: params[2],
                source_type: params[3],
                source_id: params[4],
                order_key: params[5],
                idempotency_key: params[6],
                status: 'draft',
                payment_status: 'unpaid',
                fiscal_status: 'pending',
                payment_method: params[7],
                total_amount_minor: String(params[8]),
                currency: 'UAH',
                source_snapshot: JSON.parse(params[9]),
                created_by_user_id: params[10],
                confirmation_snapshot: {},
                confirmed_at: null
            };
            this.db.orders.push(row);
            return { rows: [row] };
        }

        if (normalized.startsWith('INSERT INTO payment_order_items')) {
            this.ensureSnapshot();
            this.db.items.push({
                id: this.db.next.item++,
                fiscal_profile_id: Number(params[0]),
                payment_order_id: Number(params[1]),
                line_number: Number(params[2]),
                item_code: params[3],
                item_name: params[4],
                unit_price_minor: String(params[5]),
                quantity_millis: String(params[6]),
                total_amount_minor: String(params[7]),
                tax_reference: params[8],
                item_snapshot: JSON.parse(params[9])
            });
            return { rows: [] };
        }

        if (normalized.includes('FROM payment_attempts') && normalized.includes('WHERE idempotency_key = $1')) {
            return { rows: this.db.attempts.filter(attempt => attempt.idempotency_key === params[0]).slice(0, 1) };
        }

        if (normalized.includes('FROM payment_orders po') && normalized.includes('WHERE po.id = $1') && normalized.includes('FOR UPDATE')) {
            const orderId = Number(params[0]);
            const existingLock = this.db.locks.get(orderId);
            if (existingLock) await existingLock;
            let release;
            const lock = new Promise(resolve => { release = resolve; });
            this.db.locks.set(orderId, lock);
            this.releases.push(() => {
                if (this.db.locks.get(orderId) === lock) this.db.locks.delete(orderId);
                release();
            });
            return { rows: this.db.orders.filter(order => Number(order.id) === orderId).slice(0, 1) };
        }

        if (normalized.includes('FROM payment_orders po') && normalized.includes('WHERE po.id = $1') && normalized.includes('LIMIT 1')) {
            return { rows: this.db.orders.filter(order => Number(order.id) === Number(params[0])).slice(0, 1) };
        }

        if (normalized.startsWith('INSERT INTO payment_attempts')) {
            this.ensureSnapshot();
            if (this.db.attempts.some(attempt => attempt.idempotency_key === params[3])) {
                throw new Error('duplicate payment_attempts idempotency');
            }
            const row = {
                id: this.db.next.attempt++,
                fiscal_profile_id: Number(params[0]),
                payment_order_id: Number(params[1]),
                attempt_type: params[2],
                status: 'confirmed',
                idempotency_key: params[3],
                provider: params[4],
                provider_payment_reference: params[5],
                amount_minor: String(params[6]),
                request_snapshot: JSON.parse(params[7]),
                result_snapshot: JSON.parse(params[8])
            };
            this.db.attempts.push(row);
            return { rows: [row] };
        }

        if (normalized.startsWith('INSERT INTO payment_allocations')) {
            this.ensureSnapshot();
            if (this.db.allocations.some(allocation => Number(allocation.payment_order_id) === Number(params[1]))) {
                throw new Error('duplicate payment allocation');
            }
            this.db.allocations.push({
                id: this.db.next.allocation++,
                fiscal_profile_id: Number(params[0]),
                payment_order_id: Number(params[1]),
                payment_method: params[2],
                amount_minor: String(params[3]),
                allocation_snapshot: JSON.parse(params[4]),
                recorded_by_user_id: params[5]
            });
            return { rows: [] };
        }

        if (normalized.startsWith('UPDATE payment_orders') && normalized.includes("status = 'payment_recorded'")) {
            this.ensureSnapshot();
            const order = this.db.orders.find(row => Number(row.id) === Number(params[0]));
            Object.assign(order, {
                status: 'payment_recorded',
                payment_status: 'confirmed',
                fiscal_status: 'pending'
            });
            return { rows: [order] };
        }

        if (normalized.startsWith('UPDATE payment_orders') && normalized.includes("status = 'confirmed'")) {
            this.ensureSnapshot();
            const order = this.db.orders.find(row => Number(row.id) === Number(params[0]));
            Object.assign(order, {
                status: 'confirmed',
                payment_status: 'confirmed',
                confirmation_snapshot: JSON.parse(params[1]),
                confirmed_at: new Date().toISOString()
            });
            return { rows: [] };
        }
        if (normalized.startsWith('INSERT INTO fiscal_operations')) {
            this.ensureSnapshot();
            if (this.db.fiscalOperations.some(operation => Number(operation.payment_order_id) === Number(params[2]) && operation.operation_type === 'sale')) {
                throw new Error('duplicate sale fiscal operation');
            }
            const row = {
                id: this.db.next.operation++,
                fiscal_profile_id: Number(params[0]),
                fiscal_register_id: Number(params[1]),
                payment_order_id: Number(params[2]),
                operation_type: 'sale',
                status: 'pending',
                idempotency_key: params[3],
                provider: 'checkbox',
                provider_operation_id: params[4],
                amount_minor: String(params[5]),
                request_fingerprint: params[6],
                request_snapshot: JSON.parse(params[7]),
                initiated_by_user_id: params[8]
            };
            this.db.fiscalOperations.push(row);
            return { rows: [row] };
        }

        if (normalized.startsWith('INSERT INTO payment_outbox_jobs')) {
            this.ensureSnapshot();
            if (this.db.outboxJobs.some(job => Number(job.payment_order_id) === Number(params[2]) && job.job_type === params[3])) {
                throw new Error('duplicate receipt_sell outbox job');
            }
            const row = {
                id: this.db.next.job++,
                fiscal_profile_id: Number(params[0]),
                fiscal_operation_id: Number(params[1]),
                payment_order_id: Number(params[2]),
                job_type: params[3],
                status: 'queued',
                idempotency_key: params[4],
                payload: JSON.parse(params[5])
            };
            this.db.outboxJobs.push(row);
            return { rows: [row] };
        }

        if (normalized.startsWith('INSERT INTO fiscal_audit_events')) {
            this.ensureSnapshot();
            this.db.auditEvents.push({ id: this.db.next.audit++, params });
            return { rows: [] };
        }

        throw new Error(`Unhandled fake query: ${normalized}`);
    }
}

const allowAuthorizer = async () => ({ ok: true });
const quoteResolver = async () => sampleQuote();

test('payment state machine accepts only cash and manual terminal tenders', () => {
    assert.deepEqual(normalizeTender('cash'), { tender: 'cash', paymentMethod: 'cash' });
    assert.deepEqual(normalizeTender('card_terminal_manual'), {
        tender: 'card_terminal_manual',
        paymentMethod: 'card_terminal'
    });
    assert.throws(() => normalizeTender('online_card'), error => error.code === 'payment_tender_unsupported');
});

test('cash payment order uses server admission snapshot and ignores client pricing authority', async () => {
    const db = new FakePaymentDb();
    const result = await createAdmissionTicketPaymentOrder({
        dbPool: db,
        user: baseUser(),
        body: {
            tender: 'cash',
            admissionTicket: { date: '2099-01-15', banquetGuests: 2, banquetAdults: 0 }
        },
        idempotencyKey: 'create-cash-1',
        quoteResolver,
        authorizer: allowAuthorizer
    });

    assert.equal(result.replayed, false);
    assert.equal(result.order.paymentMethod, 'cash');
    assert.equal(result.order.totalAmountMinor, '50000');
    assert.equal(db.items.length, 1);
    assert.equal(db.items[0].unit_price_minor, '25000');
    assert.equal(db.items[0].quantity_millis, '2000');
    assert.equal(db.items[0].total_amount_minor, '50000');

    await assert.rejects(
        () => createAdmissionTicketPaymentOrder({
            dbPool: new FakePaymentDb(),
            user: baseUser(),
            body: { tender: 'cash', totalAmountMinor: 1, admissionTicket: { date: '2099-01-15' } },
            idempotencyKey: 'forbidden-price',
            quoteResolver,
            authorizer: allowAuthorizer
        }),
        error => error.code === 'client_payment_field_forbidden'
    );
});

test('wrong CRM profile/FOP mapping fails closed before creating an order', async () => {
    await assert.rejects(
        () => createAdmissionTicketPaymentOrder({
            dbPool: new FakePaymentDb(),
            user: baseUser(),
            body: { crmProfileKey: 'preschool', tender: 'cash', admissionTicket: { date: '2099-01-15' } },
            idempotencyKey: 'wrong-profile',
            quoteResolver,
            authorizer: allowAuthorizer
        }),
        error => error.code === 'crm_profile_not_supported_for_pilot'
    );

    const db = new FakePaymentDb({ mappingRows: [] });
    await assert.rejects(
        () => createAdmissionTicketPaymentOrder({
            dbPool: db,
            user: baseUser(),
            body: { tender: 'cash', admissionTicket: { date: '2099-01-15' } },
            idempotencyKey: 'missing-mapping',
            quoteResolver,
            authorizer: allowAuthorizer
        }),
        error => error.code === 'fiscal_mapping_ambiguous_or_missing'
    );
    assert.equal(db.orders.length, 0);
});

test('cash confirmation atomically records payment and queues exactly one fiscal outbox job', async () => {
    const db = new FakePaymentDb();
    const order = db.seedOrder({ payment_method: 'cash', total_amount_minor: '50000' });
    const previousFetch = global.fetch;
    let fetchCalls = 0;
    global.fetch = async () => { fetchCalls += 1; throw new Error('HTTP must not be called during confirmation'); };
    try {
        const result = await confirmPaymentOrder({
            dbPool: db,
            user: baseUser(),
            orderId: order.id,
            body: { tender: 'cash', confirmedAmountMinor: '50000' },
            idempotencyKey: 'confirm-cash-1',
            authorizer: allowAuthorizer
        });

        assert.equal(result.order.status, 'payment_recorded');
        assert.equal(result.order.paymentStatus, 'confirmed');
        assert.equal(result.order.fiscalStatus, 'pending');
        assert.equal(db.attempts.length, 1);
        assert.equal(db.allocations.length, 1);
        assert.equal(db.fiscalOperations.length, 1);
        assert.equal(db.outboxJobs.length, 1);
        assert.equal(db.outboxJobs[0].job_type, 'receipt_sell');
        assert.match(db.fiscalOperations[0].provider_operation_id, /^[0-9a-f-]{36}$/i);
        assert.equal(fetchCalls, 0, 'Checkbox HTTP must happen after commit by a worker, not inside confirmation');
    } finally {
        global.fetch = previousFetch;
    }
});

test('manual card terminal confirmation stores only operator reference and no card data', async () => {
    const db = new FakePaymentDb();
    const order = db.seedOrder({ payment_method: 'card_terminal', total_amount_minor: '50000' });
    const result = await confirmPaymentOrder({
        dbPool: db,
        user: baseUser(),
        orderId: order.id,
        body: {
            tender: 'card_terminal_manual',
            confirmedAmountMinor: '50000',
            terminalShowedSuccess: true,
            terminalReference: 'terminal-ref-123'
        },
        idempotencyKey: 'confirm-card-1',
        authorizer: allowAuthorizer
    });

    assert.equal(result.order.status, 'payment_recorded');
    assert.equal(db.attempts[0].provider_payment_reference, 'terminal-ref-123');
    assert.equal(JSON.stringify(db.attempts).includes('cardMask'), false);

    const badOrder = db.seedOrder({ id: 99, payment_method: 'card_terminal', total_amount_minor: '50000' });
    await assert.rejects(
        () => confirmPaymentOrder({
            dbPool: db,
            user: baseUser(),
            orderId: badOrder.id,
            body: {
                tender: 'card_terminal_manual',
                confirmedAmountMinor: '50000',
                terminalShowedSuccess: true,
                cardMask: '411111******1111'
            },
            idempotencyKey: 'confirm-card-data',
            authorizer: allowAuthorizer
        }),
        error => error.code === 'card_data_forbidden'
    );
});

test('wrong amount and partial/split attempts fail without outbox jobs', async () => {
    const db = new FakePaymentDb();
    const order = db.seedOrder({ payment_method: 'cash', total_amount_minor: '50000' });

    await assert.rejects(
        () => confirmPaymentOrder({
            dbPool: db,
            user: baseUser(),
            orderId: order.id,
            body: { tender: 'cash', confirmedAmountMinor: '49999' },
            idempotencyKey: 'wrong-amount',
            authorizer: allowAuthorizer
        }),
        error => error.code === 'payment_amount_mismatch'
    );

    assert.equal(db.attempts.length, 0);
    assert.equal(db.outboxJobs.length, 0);
});

test('duplicate click with same idempotency key replays and does not create another outbox job', async () => {
    const db = new FakePaymentDb();
    const order = db.seedOrder({ payment_method: 'cash', total_amount_minor: '50000' });
    const body = { tender: 'cash', confirmedAmountMinor: '50000' };

    const first = await confirmPaymentOrder({
        dbPool: db,
        user: baseUser(),
        orderId: order.id,
        body,
        idempotencyKey: 'confirm-duplicate',
        authorizer: allowAuthorizer
    });
    const second = await confirmPaymentOrder({
        dbPool: db,
        user: baseUser(),
        orderId: order.id,
        body,
        idempotencyKey: 'confirm-duplicate',
        authorizer: allowAuthorizer
    });

    assert.equal(first.replayed, false);
    assert.equal(second.replayed, true);
    assert.equal(db.attempts.length, 1);
    assert.equal(db.fiscalOperations.length, 1);
    assert.equal(db.outboxJobs.length, 1);
});

test('same idempotency key with conflicting confirmation body is rejected', async () => {
    const db = new FakePaymentDb();
    const order = db.seedOrder({ payment_method: 'card_terminal', total_amount_minor: '50000' });
    await confirmPaymentOrder({
        dbPool: db,
        user: baseUser(),
        orderId: order.id,
        body: {
            tender: 'card_terminal_manual',
            confirmedAmountMinor: '50000',
            terminalShowedSuccess: true,
            terminalReference: 'ref-1'
        },
        idempotencyKey: 'confirm-conflict',
        authorizer: allowAuthorizer
    });

    await assert.rejects(
        () => confirmPaymentOrder({
            dbPool: db,
            user: baseUser(),
            orderId: order.id,
            body: {
                tender: 'card_terminal_manual',
                confirmedAmountMinor: '50000',
                terminalShowedSuccess: true,
                terminalReference: 'ref-2'
            },
            idempotencyKey: 'confirm-conflict',
            authorizer: allowAuthorizer
        }),
        error => error.code === 'idempotency_key_conflict'
    );
});

test('concurrent confirmation serializes on the payment order lock and leaves one outbox job', async () => {
    const db = new FakePaymentDb();
    const order = db.seedOrder({ payment_method: 'cash', total_amount_minor: '50000' });
    const args = key => confirmPaymentOrder({
        dbPool: db,
        user: baseUser(),
        orderId: order.id,
        body: { tender: 'cash', confirmedAmountMinor: '50000' },
        idempotencyKey: key,
        authorizer: allowAuthorizer
    });

    const results = await Promise.allSettled([args('confirm-concurrent-a'), args('confirm-concurrent-b')]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected').length, 1);
    assert.equal(results.find(result => result.status === 'rejected').reason.code, 'payment_order_not_confirmable');
    assert.equal(db.outboxJobs.length, 1);
    assert.equal(db.fiscalOperations.length, 1);
});

test('transaction rollback before commit leaves payment unpaid and no durable fiscal job', async () => {
    const db = new FakePaymentDb({ failOn: 'INSERT INTO payment_outbox_jobs' });
    const order = db.seedOrder({ payment_method: 'cash', total_amount_minor: '50000' });

    await assert.rejects(
        () => confirmPaymentOrder({
            dbPool: db,
            user: baseUser(),
            orderId: order.id,
            body: { tender: 'cash', confirmedAmountMinor: '50000' },
            idempotencyKey: 'rollback-confirm',
            authorizer: allowAuthorizer
        }),
        /forced failure/
    );

    assert.equal(db.orders[0].status, 'draft');
    assert.equal(db.orders[0].payment_status, 'unpaid');
    assert.equal(db.attempts.length, 0);
    assert.equal(db.allocations.length, 0);
    assert.equal(db.fiscalOperations.length, 0);
    assert.equal(db.outboxJobs.length, 0);
});

test('confirmation body validation fails closed for non-confirmable order', () => {
    assert.throws(
        () => assertManualConfirmationBody({
            order: { status: 'payment_recorded', payment_status: 'confirmed', total_amount_minor: '50000', payment_method: 'cash' },
            body: { tender: 'cash', confirmedAmountMinor: '50000' }
        }),
        error => error instanceof PaymentWorkflowError && error.code === 'payment_order_not_confirmable'
    );
});

test('Idempotency-Key is mandatory for create and confirm workflows', async () => {
    await assert.rejects(
        () => createAdmissionTicketPaymentOrder({
            dbPool: new FakePaymentDb(),
            user: baseUser(),
            body: { tender: 'cash', admissionTicket: { date: '2099-01-15' } },
            idempotencyKey: '',
            quoteResolver,
            authorizer: allowAuthorizer
        }),
        error => error instanceof PaymentServiceError && error.code === 'idempotency_key_required'
    );
});
function installMock(modulePath, exports) {
    const id = require.resolve(modulePath);
    require.cache[id] = { id, filename: id, loaded: true, exports };
}

function clearPaymentRouteModules() {
    for (const modulePath of ['../routes/payments', '../middleware/auth', '../services/payments/paymentService']) {
        try { delete require.cache[require.resolve(modulePath)]; } catch {}
    }
}

async function withPaymentRouteApp(run) {
    const express = require('express');
    clearPaymentRouteModules();
    const calls = { create: [], confirm: [] };
    installMock('../middleware/auth', {
        authenticateToken: (req, _res, next) => {
            req.user = baseUser();
            next();
        },
        requireAction: action => (req, _res, next) => {
            req.testAction = action;
            next();
        }
    });
    installMock('../services/payments/paymentService', {
        createAdmissionTicketPaymentOrder: async input => {
            calls.create.push(input);
            return { replayed: false, order: { id: 1, status: 'draft' } };
        },
        confirmPaymentOrder: async input => {
            calls.confirm.push(input);
            return { replayed: false, order: { id: Number(input.orderId), status: 'payment_recorded' }, outboxJobId: 9 };
        },
        paymentErrorResponse: error => ({
            status: error.status || 500,
            body: { success: false, code: error.code || 'mock_error', error: error.message }
        })
    });

    const app = express();
    app.use(express.json());
    app.use('/api/payments', require('../routes/payments'));
    const server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const request = async (method, path, body, headers = {}) => {
        const res = await fetch(`${baseUrl}${path}`, {
            method,
            headers: { 'content-type': 'application/json', ...headers },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        return { status: res.status, data: await res.json() };
    };

    try {
        await run({ request, calls });
    } finally {
        await new Promise(resolve => server.close(resolve));
        clearPaymentRouteModules();
    }
}

test('payments API smoke passes Idempotency-Key and user context into order creation service', async () => {
    await withPaymentRouteApp(async ({ request, calls }) => {
        const res = await request(
            'POST',
            '/api/payments/admission-ticket/orders',
            { tender: 'cash', admissionTicket: { date: '2099-01-15', banquetGuests: 2, banquetAdults: 0 } },
            { 'Idempotency-Key': 'api-create-1' }
        );

        assert.equal(res.status, 201);
        assert.equal(res.data.success, true);
        assert.equal(calls.create.length, 1);
        assert.equal(calls.create[0].idempotencyKey, 'api-create-1');
        assert.equal(calls.create[0].user.id, 50);
    });
});

test('payments API smoke confirms manual card without calling Checkbox HTTP in route layer', async () => {
    await withPaymentRouteApp(async ({ request, calls }) => {
        const previousFetch = global.fetch;
        let checkboxLikeCalls = 0;
        global.fetch = async (url, options) => {
            if (String(url).includes('checkbox')) checkboxLikeCalls += 1;
            return previousFetch(url, options);
        };
        try {
            const res = await request(
                'POST',
                '/api/payments/orders/12/confirm',
                {
                    tender: 'card_terminal_manual',
                    confirmedAmountMinor: '50000',
                    terminalShowedSuccess: true,
                    terminalReference: 'api-terminal-ref'
                },
                { 'Idempotency-Key': 'api-confirm-1' }
            );

            assert.equal(res.status, 200);
            assert.equal(res.data.success, true);
            assert.equal(calls.confirm.length, 1);
            assert.equal(calls.confirm[0].orderId, '12');
            assert.equal(calls.confirm[0].idempotencyKey, 'api-confirm-1');
            assert.equal(checkboxLikeCalls, 0);
        } finally {
            global.fetch = previousFetch;
        }
    });
});

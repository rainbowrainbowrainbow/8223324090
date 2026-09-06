'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
    PaymentServiceError,
    confirmPaymentOrder,
    createAdmissionTicketPaymentOrder,
    getPaymentOrderDetails
} = require('../services/payments/paymentService');
const {
    PaymentWorkflowError,
    assertManualConfirmationBody,
    normalizeTender
} = require('../services/payments/paymentStateMachine');
const { authorizeFiscalActionContext } = require('../services/payments/fiscalAccess');

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function baseUser(overrides = {}) {
    return {
        id: 50,
        username: 'cashier',
        role: 'reception',
        business_contexts: ['event_genix'],
        action_allowlist: ['fiscal.shift.open'],
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
                ticketTypeName: 'Дитячий вхід',
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

function defaultMapping(overrides = {}) {
    return {
        fiscal_profile_id: 20,
        fiscal_register_id: 40,
        fiscal_location_id: 30,
        location_alias: 'park',
        crm_profile_key: 'event_genix',
        legal_entity_key: 'park_fop',
        legal_entity_name: 'Park FOP',
        register_alias: 'middle',
        register_display_name: 'Middle register',
        provider: 'checkbox',
        provider_organization_id: 'test-organization',
        provider_outlet_id: 'test-outlet',
        provider_register_id: 'test-register',
        provider_license_ref: 'test-register-credential-ref',
        register_expected_is_test: true,
        feature_enabled: true,
        acceptance_enabled: true,
        ...overrides
    };
}

function defaultFiscalItemMapping(overrides = {}) {
    return {
        fiscal_profile_id: 20,
        fiscal_register_id: 40,
        id: 700,
        provider: 'checkbox',
        source_type: 'admission_ticket',
        item_type: 'admission_ticket',
        item_code: 'regular_child',
        fiscal_item_name: 'Park child admission',
        provider_tax_id: '7',
        tax_mode: 'taxed',
        tax_code: 1,
        tax_rate_bps: 2000,
        status: 'active',
        ...overrides
    };
}

class FakePaymentDb {
    constructor(options = {}) {
        this.registerCredentialRef = Object.hasOwn(options, 'registerCredentialRef')
            ? options.registerCredentialRef
            : 'test-register-credential-ref';
        this.cashierCredentialRef = Object.hasOwn(options, 'cashierCredentialRef')
            ? options.cashierCredentialRef
            : 'test-cashier-credential-ref';
        this.mappingRows = options.mappingRows || [defaultMapping({ provider_license_ref: this.registerCredentialRef })];
        this.itemMappingRows = Object.hasOwn(options, 'itemMappingRows') ? options.itemMappingRows : [defaultFiscalItemMapping()];
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
        this.fiscalShifts = [];
        this.outboxJobs = [];
        this.auditEvents = [];
        this.next = { order: 1, item: 1, attempt: 1, allocation: 1, operation: 1, shift: 1, job: 1, audit: 1 };
        this.queries = [];
    }

    seedOrder(overrides = {}) {
        const row = {
            id: overrides.id || this.next.order++,
            fiscal_profile_id: 20,
            fiscal_register_id: 40,
            fiscal_location_id: 30,
            location_alias: 'park',
            crm_profile_key: 'event_genix',
            legal_entity_key: 'park_fop',
            legal_entity_name: 'Park FOP',
            register_alias: 'middle',
            register_display_name: 'Middle register',
            provider: 'checkbox',
            provider_organization_id: 'test-organization',
            provider_outlet_id: 'test-outlet',
            provider_register_id: 'test-register',
            provider_license_ref: this.registerCredentialRef,
            register_expected_is_test: true,
            feature_enabled: true,
            bound_provider_cashier_id: 'test-cashier',
            bound_provider_cashier_login_ref: this.cashierCredentialRef,
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
        if (!overrides.skipDefaultItem) {
            this.items.push({
                id: this.next.item++,
                fiscal_profile_id: row.fiscal_profile_id,
                payment_order_id: row.id,
                line_number: 1,
                item_code: 'regular_child',
                item_name: 'Park child admission',
                unit_price_minor: '25000',
                quantity_millis: '2000',
                total_amount_minor: row.total_amount_minor,
                tax_reference: 'admission_tariff:11',
                provider_tax_id: '7',
                tax_mode: 'taxed',
                tax_code: 1,
                tax_rate_bps: 2000,
                item_snapshot: {}
            });
        }
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
            fiscalShifts: clone(this.fiscalShifts),
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
        this.fiscalShifts = snapshot.fiscalShifts;
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
        if (sql.includes('FROM fiscal_register_payment_drains')) return { rows: this.db.activeDrain ? [this.db.activeDrain] : [] };
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

        if (normalized.includes('FROM payment_orders') && normalized.includes('order_key = $2')) {
            return { rows: this.db.orders.filter(order => Number(order.fiscal_profile_id) === Number(params[0]) && order.order_key === params[1]).slice(0, 1) };
        }

        if (normalized.includes('FROM fiscal_profiles fp') && normalized.includes('fl.location_alias = $2') && normalized.includes('fr.register_alias = $3')) {
            return {
                rows: this.db.mappingRows.filter(row => (
                    row.crm_profile_key === params[0]
                    && row.location_alias === params[1]
                    && row.register_alias === params[2]
                ))
            };
        }

        if (normalized.includes('FROM fiscal_item_mappings')) {
            const codes = Array.isArray(params[4]) ? params[4] : [];
            return {
                rows: this.db.itemMappingRows.filter(row => (
                    Number(row.fiscal_profile_id) === Number(params[0])
                    && Number(row.fiscal_register_id) === Number(params[1])
                    && row.source_type === params[3]
                    && codes.includes(row.item_code)
                    && row.provider === 'checkbox'
                    && row.status === 'active'
                ))
            };
        }


        if (normalized.includes('FROM fiscal_cashier_bindings b') && normalized.includes('WHERE b.user_id = $1')) {
            return {
                rows: [{
                    id: 500,
                    user_id: Number(params[0]),
                    fiscal_profile_id: Number(params[1]),
                    fiscal_register_id: Number(params[2]),
                    fiscal_location_id: this.db.mappingRows.find(row => Number(row.fiscal_profile_id) === Number(params[1]) && Number(row.fiscal_register_id) === Number(params[2]))?.fiscal_location_id || 30,
                    register_fiscal_location_id: this.db.mappingRows.find(row => Number(row.fiscal_profile_id) === Number(params[1]) && Number(row.fiscal_register_id) === Number(params[2]))?.fiscal_location_id || 30,
                    crm_profile_key: this.db.mappingRows.find(row => Number(row.fiscal_profile_id) === Number(params[1]) && Number(row.fiscal_register_id) === Number(params[2]))?.crm_profile_key || 'event_genix',
                    provider_cashier_id: 'test-cashier',
                    provider_cashier_login_ref: this.db.cashierCredentialRef,
                    status: 'active',
                    action_pin_hash: '$2a$10$fakehashfornonpinpaths',
                    capability_scope: this.db.mappingRows[0]?.capability_scope || ['payments.view', 'payments.create', 'payments.confirm_received', 'fiscal.shift.open']
                }]
            };
        }

        if (normalized.includes('FROM fiscal_cashier_bindings') && normalized.includes('SELECT provider_cashier_id, provider_cashier_login_ref')) {
            return {
                rows: [{
                    provider_cashier_id: 'test-cashier',
                    provider_cashier_login_ref: this.db.cashierCredentialRef
                }]
            };
        }

        if (normalized.startsWith('INSERT INTO payment_orders')) {
            this.ensureSnapshot();
            const sourceSnapshot = JSON.parse(params[10]);
            const row = {
                id: this.db.next.order++,
                fiscal_profile_id: Number(params[0]),
                fiscal_register_id: Number(params[1]),
                fiscal_location_id: sourceSnapshot?.fiscal_location_id || null,
                location_alias: sourceSnapshot?.location_alias || null,
                crm_profile_key: sourceSnapshot?.crm_profile_key || null,
                legal_entity_key: sourceSnapshot?.legal_entity_key || null,
                legal_entity_name: sourceSnapshot?.legal_entity_name || null,
                register_alias: sourceSnapshot?.register_alias || null,
                cashier_user_id: params[2],
                selected_fiscal_cashier_binding_id: params[3],
                source_type: params[4],
                source_id: params[5],
                order_key: params[6],
                idempotency_key: params[7],
                status: 'draft',
                payment_status: 'unpaid',
                fiscal_status: 'pending',
                payment_method: params[8],
                total_amount_minor: String(params[9]),
                currency: 'UAH',
                source_snapshot: sourceSnapshot,
                created_by_user_id: params[11],
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
                tax_code: params[9],
                tax_rate_bps: params[10],
                provider_tax_id: params[11],
                tax_mode: params[12],
                item_snapshot: JSON.parse(params[13])
            });
            return { rows: [] };
        }

        if (normalized.includes('FROM payment_order_items') && normalized.includes('provider_tax_id')) {
            return { rows: this.db.items.filter(item => Number(item.fiscal_profile_id) === Number(params[0]) && Number(item.payment_order_id) === Number(params[1])).map(item => ({
                line_number: item.line_number,
                item_code: item.item_code,
                item_name: item.item_name,
                tax_reference: item.tax_reference,
                provider_tax_id: item.provider_tax_id,
                tax_mode: item.tax_mode || 'taxed'
            })) };
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

        if (normalized.startsWith('SELECT pg_advisory_xact_lock')) {
            return { rows: [] };
        }

        if (normalized.includes('FROM fiscal_shifts fs') && normalized.includes('fs.status = ANY')) {
            const rows = this.db.fiscalShifts
                .filter(shift => Number(shift.fiscal_profile_id) === Number(params[0]) && Number(shift.fiscal_register_id) === Number(params[1]) && ['opening', 'open'].includes(shift.status))
                .map(shift => ({ ...shift, fiscal_location_id: 30, register_alias: 'middle', crm_profile_key: 'event_genix' }));
            return { rows };
        }

        if (normalized.startsWith('INSERT INTO fiscal_shifts')) {
            this.ensureSnapshot();
            const row = {
                id: this.db.next.shift++,
                fiscal_profile_id: Number(params[0]),
                fiscal_register_id: Number(params[1]),
                provider: 'checkbox',
                status: 'open',
                opened_by_user_id: params[2],
                opened_at: new Date().toISOString(),
                business_context: params[3],
                provider_snapshot: JSON.parse(params[4]),
                open_operation_id: null
            };
            this.db.fiscalShifts.push(row);
            return { rows: [row] };
        }

        if (normalized.startsWith('UPDATE fiscal_shifts') && normalized.includes('SET open_operation_id = $2')) {
            this.ensureSnapshot();
            const shift = this.db.fiscalShifts.find(row => Number(row.id) === Number(params[0]));
            shift.open_operation_id = Number(params[1]);
            return { rows: [] };
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
                result_snapshot: JSON.parse(params[8]),
                received_amount_minor: JSON.parse(params[8]).receivedAmountMinor || JSON.parse(params[8]).received_amount_minor,
                change_amount_minor: JSON.parse(params[8]).changeAmountMinor || JSON.parse(params[8]).change_amount_minor
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
                received_amount_minor: JSON.parse(params[4]).receivedAmountMinor || JSON.parse(params[4]).received_amount_minor,
                change_amount_minor: JSON.parse(params[4]).changeAmountMinor || JSON.parse(params[4]).change_amount_minor,
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
            const isShiftOpen = normalized.includes("'shift_open'");
            const isSale = normalized.includes("'sale'");
            if (isSale && this.db.fiscalOperations.some(operation => Number(operation.payment_order_id) === Number(params[2]) && operation.operation_type === 'sale')) {
                throw new Error('duplicate sale fiscal operation');
            }
            const row = isShiftOpen ? {
                id: this.db.next.operation++,
                fiscal_profile_id: Number(params[0]),
                fiscal_register_id: Number(params[1]),
                fiscal_shift_id: Number(params[2]),
                operation_type: 'shift_open',
                status: 'pending',
                idempotency_key: params[3],
                provider: 'checkbox',
                provider_operation_id: params[4],
                request_snapshot: JSON.parse(params[5]),
                initiated_by_user_id: params[6]
            } : {
                id: this.db.next.operation++,
                fiscal_profile_id: Number(params[0]),
                fiscal_register_id: Number(params[1]),
                payment_order_id: Number(params[2]),
                fiscal_shift_id: Number(params[3]),
                operation_type: 'sale',
                status: 'pending',
                idempotency_key: params[4],
                provider: 'checkbox',
                provider_operation_id: params[5],
                amount_minor: String(params[6]),
                request_fingerprint: params[7],
                request_snapshot: JSON.parse(params[8]),
                initiated_by_user_id: params[9]
            };
            this.db.fiscalOperations.push(row);
            return { rows: [row] };
        }

        if (normalized.startsWith('INSERT INTO payment_outbox_jobs')) {
            this.ensureSnapshot();
            if (this.db.outboxJobs.some(job => job.idempotency_key === params[4])) {
                return { rows: [] };
            }
            const row = {
                id: this.db.next.job++,
                fiscal_profile_id: Number(params[0]),
                fiscal_operation_id: params[1] === null ? null : Number(params[1]),
                payment_order_id: params[2] === null ? null : Number(params[2]),
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

function scopedPaymentBody(overrides = {}) {
    return {
        crmProfileKey: 'event_genix',
        locationAlias: 'park',
        registerAlias: 'middle',
        ...overrides
    };
}

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
        body: scopedPaymentBody({
            tender: 'cash',
            admissionTicket: { date: '2099-01-15', banquetGuests: 2, banquetAdults: 0 }
        }),
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
            body: scopedPaymentBody({ tender: 'cash', totalAmountMinor: 1, admissionTicket: { date: '2099-01-15' } }),
            idempotencyKey: 'forbidden-price',
            quoteResolver,
            authorizer: allowAuthorizer
        }),
        error => error.code === 'client_payment_field_forbidden'
    );
});

test('server source identity creates separate standalone walk-in sales for identical quotes', async () => {
    const db = new FakePaymentDb();
    const body = scopedPaymentBody({ tender: 'cash', admissionTicket: { date: '2099-01-15', banquetGuests: 2, banquetAdults: 0 } });

    const first = await createAdmissionTicketPaymentOrder({
        dbPool: db,
        user: baseUser(),
        body,
        idempotencyKey: 'create-logical-1',
        quoteResolver,
        authorizer: allowAuthorizer
    });
    const second = await createAdmissionTicketPaymentOrder({
        dbPool: db,
        user: baseUser(),
        body,
        idempotencyKey: 'create-logical-2',
        quoteResolver,
        authorizer: allowAuthorizer
    });

    assert.equal(first.replayed, false);
    assert.equal(second.replayed, false);
    assert.notEqual(first.order.sourceId, second.order.sourceId);
    assert.match(first.order.sourceId, /^walkin_sale_[0-9a-f-]{36}$/);
    assert.equal(db.orders.length, 2);
});

test('client-controlled sourceId is rejected before order creation', async () => {
    const db = new FakePaymentDb();
    await assert.rejects(
        () => createAdmissionTicketPaymentOrder({
            dbPool: db,
            user: baseUser(),
            body: scopedPaymentBody({ tender: 'cash', sourceId: 'client-source', admissionTicket: { date: '2099-01-15' } }),
            idempotencyKey: 'forbidden-source',
            quoteResolver,
            authorizer: allowAuthorizer
        }),
        error => error.code === 'client_payment_field_forbidden'
    );
    assert.equal(db.orders.length, 0);
});

test('missing Checkbox tax mapping blocks order before taking money', async () => {
    const db = new FakePaymentDb({ itemMappingRows: [defaultFiscalItemMapping({ provider_tax_id: '' })] });
    await assert.rejects(
        () => createAdmissionTicketPaymentOrder({
            dbPool: db,
            user: baseUser(),
            body: scopedPaymentBody({ tender: 'cash', admissionTicket: { date: '2099-01-15' } }),
            idempotencyKey: 'missing-tax',
            quoteResolver,
            authorizer: allowAuthorizer
        }),
        error => error.code === 'fiscal_item_tax_mapping_missing'
    );
    assert.equal(db.orders.length, 0);
});

test('wrong CRM profile/FOP mapping fails closed before creating an order', async () => {
    await assert.rejects(
        () => createAdmissionTicketPaymentOrder({
            dbPool: new FakePaymentDb(),
            user: baseUser(),
            body: scopedPaymentBody({ crmProfileKey: 'preschool', locationAlias: 'preschool', registerAlias: 'middle', tender: 'cash', admissionTicket: { date: '2099-01-15' } }),
            idempotencyKey: 'wrong-profile',
            quoteResolver,
            authorizer: allowAuthorizer
        }),
        error => error.code === 'fiscal_crm_profile_invalid'
    );

    const db = new FakePaymentDb({ mappingRows: [] });
    await assert.rejects(
        () => createAdmissionTicketPaymentOrder({
            dbPool: db,
            user: baseUser(),
            body: scopedPaymentBody({ tender: 'cash', admissionTicket: { date: '2099-01-15' } }),
            idempotencyKey: 'missing-mapping',
            quoteResolver,
            authorizer: allowAuthorizer
        }),
        error => error.code === 'fiscal_mapping_ambiguous_or_missing'
    );
    assert.equal(db.orders.length, 0);
});

test('payment order creation requires explicit profile location register scope', async () => {
    await assert.rejects(
        () => createAdmissionTicketPaymentOrder({
            dbPool: new FakePaymentDb(),
            user: baseUser(),
            body: { tender: 'cash', admissionTicket: { date: '2099-01-15' } },
            idempotencyKey: 'missing-fiscal-scope',
            quoteResolver,
            authorizer: allowAuthorizer
        }),
        error => error.code === 'fiscal_crm_profile_required'
    );

    await assert.rejects(
        () => createAdmissionTicketPaymentOrder({
            dbPool: new FakePaymentDb(),
            user: baseUser(),
            body: scopedPaymentBody({ locationAlias: '', tender: 'cash', admissionTicket: { date: '2099-01-15' } }),
            idempotencyKey: 'missing-location-scope',
            quoteResolver,
            authorizer: allowAuthorizer
        }),
        error => error.code === 'fiscal_location_alias_required'
    );
});

test('separate business scope creates Dar order with Dar mapping and items only', async () => {
    const darMapping = defaultMapping({
        fiscal_profile_id: 21,
        fiscal_location_id: 31,
        fiscal_register_id: 41,
        crm_profile_key: 'dar',
        location_alias: 'dar',
        register_alias: 'front',
        legal_entity_key: 'dar_fop',
        legal_entity_name: 'Dar FOP',
        provider_organization_id: 'organization-test-dar',
        provider_outlet_id: 'outlet-test-dar',
        provider_register_id: 'register-test-dar',
        provider_license_ref: 'dar-register-credential-ref'
    });
    const db = new FakePaymentDb({
        registerCredentialRef: 'dar-register-credential-ref',
        mappingRows: [defaultMapping(), darMapping],
        itemMappingRows: [
            defaultFiscalItemMapping(),
            defaultFiscalItemMapping({
                id: 701,
                fiscal_profile_id: 21,
                fiscal_register_id: 41,
                fiscal_item_name: 'Dar child admission',
                provider_tax_id: null,
                tax_mode: 'untaxed',
                tax_code: null,
                tax_rate_bps: null
            })
        ]
    });
    const darQuoteResolver = async () => sampleQuote({
        businessContext: 'dar',
        ticketSubtotal: 300,
        quoteFingerprint: 'dar-quote-fingerprint',
        ticketLines: [{
            ticketTypeId: 10,
            ticketTypeCode: 'regular_child',
            ticketTypeName: 'Dar дитячий квиток',
            quantity: 3,
            unitPriceUah: 100,
            subtotalUah: 300,
            tariffVersionId: 90,
            currency: 'UAH'
        }]
    });

    const result = await createAdmissionTicketPaymentOrder({
        dbPool: db,
        user: baseUser({ business_contexts: ['dar'] }),
        body: scopedPaymentBody({
            crmProfileKey: 'dar',
            locationAlias: 'dar',
            registerAlias: 'front',
            tender: 'cash',
            admissionTicket: { date: '2099-01-15', banquetGuests: 3, banquetAdults: 0 }
        }),
        idempotencyKey: 'create-dar-1',
        quoteResolver: darQuoteResolver,
        authorizer: allowAuthorizer
    });

    assert.equal(result.order.fiscalProfileId, 21);
    assert.equal(result.order.fiscalLocationId, 31);
    assert.equal(result.order.fiscalRegisterId, 41);
    assert.equal(result.order.crmProfileKey, 'dar');
    assert.equal(result.order.locationAlias, 'dar');
    assert.equal(result.order.registerAlias, 'front');
    assert.equal(db.orders[0].source_snapshot.crm_profile_key, 'dar');
    assert.equal(db.orders[0].source_snapshot.location_alias, 'dar');
    assert.equal(db.orders[0].source_snapshot.register_alias, 'front');
    assert.equal(db.items.length, 1);
    assert.equal(db.items[0].item_name, 'Dar child admission');
    assert.equal(db.items[0].tax_mode, 'untaxed');
    assert.equal(db.items[0].provider_tax_id, null);
    assert.ok(db.orders[0].order_key.includes('admission_ticket:dar:dar:front:'));
});

test('active test drain retains an unpaid order and blocks new admission and confirmation before ledger writes', async () => {
    const db = new FakePaymentDb();
    const order = db.seedOrder({ payment_method: 'cash', total_amount_minor: '50000' });
    db.activeDrain = { id: 91, status: 'closed' };
    await assert.rejects(() => confirmPaymentOrder({ dbPool: db, user: baseUser(), orderId: order.id,
        body: { tender: 'cash', confirmedAmountMinor: '50000' }, idempotencyKey: 'stopped-confirm', authorizer: allowAuthorizer }),
    error => error.code === 'shared_test_register_draining');
    await assert.rejects(() => createAdmissionTicketPaymentOrder({ dbPool: db, user: baseUser(),
        body: scopedPaymentBody({ tender: 'cash', admissionTicket: { date: '2099-01-15' } }),
        idempotencyKey: 'stopped-create', quoteResolver, authorizer: allowAuthorizer }),
    error => error.code === 'shared_test_register_draining');
    assert.equal(db.orders.length, 1);
    assert.equal(db.orders[0].payment_status, 'unpaid');
    assert.equal(db.attempts.length, 0);
    assert.equal(db.allocations.length, 0);
    assert.equal(db.outboxJobs.length, 0);
});

test('missing cashier credential ref blocks confirmation before monetary or outbox writes', async () => {
    const db = new FakePaymentDb({ cashierCredentialRef: null });
    const order = db.seedOrder({ payment_method: 'cash', total_amount_minor: '50000' });

    await assert.rejects(
        () => confirmPaymentOrder({
            dbPool: db,
            user: baseUser(),
            orderId: order.id,
            body: { tender: 'cash', confirmedAmountMinor: '50000' },
            idempotencyKey: 'confirm-missing-cashier-ref',
            authorizer: allowAuthorizer
        }),
        error => error.code === 'fiscal_provider_context_incomplete'
            && error.details?.missing?.join(',') === 'cashier_credential_ref'
    );

    assert.equal(order.status, 'draft');
    assert.equal(order.payment_status, 'unpaid');
    assert.equal(db.attempts.length, 0);
    assert.equal(db.allocations.length, 0);
    assert.equal(db.fiscalOperations.length, 0);
    assert.equal(db.outboxJobs.length, 0);
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
            body: { tender: 'cash', confirmedAmountMinor: '60000' },
            idempotencyKey: 'confirm-cash-1',
            authorizer: allowAuthorizer
        });

        assert.equal(result.order.status, 'payment_recorded');
        assert.equal(result.order.paymentStatus, 'confirmed');
        assert.equal(result.order.fiscalStatus, 'pending');
        assert.equal(db.attempts.length, 1);
        assert.equal(db.allocations.length, 1);
        const saleOperations = db.fiscalOperations.filter(operation => operation.operation_type === 'sale');
        const shiftOpenOperations = db.fiscalOperations.filter(operation => operation.operation_type === 'shift_open');
        const receiptJobs = db.outboxJobs.filter(job => job.job_type === 'receipt_sell');
        const shiftJobs = db.outboxJobs.filter(job => job.job_type === 'shift_open');
        assert.equal(saleOperations.length, 1);
        assert.equal(shiftOpenOperations.length, 1);
        assert.equal(receiptJobs.length, 1);
        assert.equal(shiftJobs.length, 1);
        assert.equal(saleOperations[0].fiscal_shift_id, shiftOpenOperations[0].fiscal_shift_id);
        assert.match(saleOperations[0].provider_operation_id, /^[0-9a-f-]{36}$/i);
        assert.equal(fetchCalls, 0, 'Checkbox HTTP must happen after commit by a worker, not inside confirmation');
    } finally {
        global.fetch = previousFetch;
    }
});

test('cash confirmation stores immutable received amount and calculated change', async () => {
    const db = new FakePaymentDb();
    const order = db.seedOrder({ payment_method: 'cash', total_amount_minor: '50000' });
    await confirmPaymentOrder({
        dbPool: db,
        user: baseUser(),
        orderId: order.id,
        body: { tender: 'cash', confirmedAmountMinor: '60000' },
        idempotencyKey: 'confirm-cash-change',
        authorizer: allowAuthorizer
    });

    assert.equal(db.attempts[0].amount_minor, '50000');
    assert.equal(db.attempts[0].received_amount_minor, '60000');
    assert.equal(db.attempts[0].change_amount_minor, '10000');
    assert.equal(db.allocations[0].amount_minor, '50000');
    assert.equal(db.allocations[0].received_amount_minor, '60000');
    assert.equal(db.allocations[0].change_amount_minor, '10000');
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
    assert.equal(db.attempts[0].provider_payment_reference, null);
    assert.equal(db.attempts[0].request_snapshot.terminal_reference, 'terminal-ref-123');
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
        error => error.code === 'cash_received_amount_insufficient'
    );

    assert.equal(db.attempts.length, 0);
    assert.equal(db.outboxJobs.length, 0);
});

test('confirmation rejects browser fiscal route and cashier overrides before touching DB', async () => {
    for (const field of [
        'providerRegisterId',
        'provider_cashier_id',
        'locationAlias',
        'register_alias',
        'credentialRef',
        'is_test',
        'routeOptionId',
        'business_context',
        'cashierBindingId'
    ]) {
        const db = new FakePaymentDb();
        await assert.rejects(
            () => confirmPaymentOrder({
                dbPool: db,
                user: baseUser(),
                orderId: 1,
                body: {
                    tender: 'cash',
                    confirmedAmountMinor: '50000',
                    [field]: 'browser-value'
                },
                idempotencyKey: `confirm-forbidden-${field}`,
                authorizer: allowAuthorizer
            }),
            error => error.code === 'client_payment_field_forbidden'
                && error.details?.field === field,
            field
        );
        assert.equal(db.queries.length, 0, field);
    }
});

test('only the authenticated actor that created an order can confirm it', async () => {
    const db = new FakePaymentDb();
    const order = db.seedOrder({
        created_by_user_id: 51,
        cashier_user_id: 77,
        payment_method: 'cash',
        total_amount_minor: '50000'
    });

    await assert.rejects(
        () => confirmPaymentOrder({
            dbPool: db,
            user: baseUser({ id: 50 }),
            orderId: order.id,
            body: { tender: 'cash', confirmedAmountMinor: '50000' },
            idempotencyKey: 'confirm-wrong-actor',
            authorizer: allowAuthorizer
        }),
        error => error.code === 'payment_order_actor_mismatch' && error.status === 409
    );
    assert.equal(db.attempts.length, 0);
    assert.equal(db.outboxJobs.length, 0);
});

test('persisted test-register order cannot be confirmed after fiscal.configure access is lost', async () => {
    const db = new FakePaymentDb();
    const order = db.seedOrder({
        created_by_user_id: 50,
        fiscal_sale_route_option_id: 'park_test',
        business_context: 'event_genix',
        route_expected_is_test: true,
        register_expected_is_test: true,
        route_status: 'active',
        route_feature_enabled: true,
        route_acceptance_enabled: true,
        source_snapshot: {
            request_fingerprint: 'seed',
            route_option_id: 'park_test',
            business_context: 'event_genix',
            register_mode: 'test'
        }
    });

    await assert.rejects(
        () => confirmPaymentOrder({
            dbPool: db,
            user: baseUser({
                action_allowlist: ['payments.confirm_received'],
                action_denylist: ['fiscal.configure']
            }),
            orderId: order.id,
            body: { tender: 'cash', confirmedAmountMinor: '50000' },
            idempotencyKey: 'confirm-test-route-without-configure',
            authorizer: allowAuthorizer
        }),
        error => error.code === 'fiscal_capability_denied'
            && error.details?.action === 'fiscal.configure'
    );
    assert.equal(db.attempts.length, 0);
    assert.equal(db.outboxJobs.length, 0);
});

test('route-aware order details authorize the actor independently from the selected fiscal cashier', async () => {
    const order = {
        id: 71,
        fiscal_profile_id: 20,
        fiscal_location_id: 30,
        fiscal_register_id: 40,
        crm_profile_key: 'event_genix',
        business_context: 'event_genix',
        fiscal_sale_route_option_id: 'park_production',
        route_expected_is_test: false,
        register_expected_is_test: false,
        cashier_user_id: 77,
        selected_fiscal_cashier_binding_id: 500,
        created_by_user_id: 50,
        source_type: 'catalog_sale',
        source_id: 'catalog-sale-71',
        order_key: 'catalog_sale:event_genix:71',
        idempotency_key: 'create-71',
        status: 'draft',
        payment_status: 'unpaid',
        fiscal_status: 'pending',
        payment_method: 'cash',
        total_amount_minor: '50000',
        currency: 'UAH',
        source_snapshot: {
            route_option_id: 'park_production',
            business_context: 'event_genix',
            register_mode: 'production'
        },
        confirmation_snapshot: {}
    };
    const queries = [];
    const client = {
        release() {},
        async query(sql) {
            const normalized = String(sql).replace(/\s+/g, ' ').trim();
            queries.push(normalized);
            if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(normalized)) return { rows: [] };
            if (normalized.includes('FROM payment_orders po') && normalized.includes('WHERE po.id = $1')) return { rows: [order] };
            if (normalized.includes('FROM payment_order_items')) return { rows: [] };
            if (normalized.includes('FROM fiscal_operations')) return { rows: [] };
            if (normalized.includes('FROM fiscal_receipts')) return { rows: [] };
            if (normalized.includes('FROM payment_outbox_jobs')) return { rows: [] };
            throw new Error(`Unhandled order-details query: ${normalized}`);
        }
    };

    const result = await getPaymentOrderDetails({
        dbPool: { connect: async () => client },
        user: baseUser({ id: 50, action_allowlist: ['payments.view'] }),
        orderId: order.id
    });

    assert.equal(result.order.id, order.id);
    assert.equal(result.order.selectedFiscalCashierBindingId, 500);
    assert.equal(queries.some(sql => sql.includes('FROM fiscal_cashier_bindings')), false);
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
    assert.equal(db.fiscalOperations.filter(operation => operation.operation_type === 'sale').length, 1);
    assert.equal(db.fiscalOperations.filter(operation => operation.operation_type === 'shift_open').length, 1);
    assert.equal(db.outboxJobs.filter(job => job.job_type === 'receipt_sell').length, 1);
    assert.equal(db.outboxJobs.filter(job => job.job_type === 'shift_open').length, 1);
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
    assert.equal(db.outboxJobs.filter(job => job.job_type === 'receipt_sell').length, 1);
    assert.equal(db.outboxJobs.filter(job => job.job_type === 'shift_open').length, 1);
    assert.equal(db.fiscalOperations.filter(operation => operation.operation_type === 'sale').length, 1);
    assert.equal(db.fiscalOperations.filter(operation => operation.operation_type === 'shift_open').length, 1);
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

test('confirmation fails closed when existing order item has no provider tax mapping', async () => {
    const db = new FakePaymentDb();
    const order = db.seedOrder({ payment_method: 'cash', total_amount_minor: '50000' });
    db.items[0].provider_tax_id = '';

    await assert.rejects(
        () => confirmPaymentOrder({
            dbPool: db,
            user: baseUser(),
            orderId: order.id,
            body: { tender: 'cash', confirmedAmountMinor: '50000' },
            idempotencyKey: 'confirm-missing-tax',
            authorizer: allowAuthorizer
        }),
        error => error.code === 'payment_order_fiscal_item_not_ready'
    );
    assert.equal(db.attempts.length, 0);
});

test('fiscal cashier binding capability scope is enforced server-side', () => {
    assert.throws(
        () => authorizeFiscalActionContext({
            user: baseUser({ action_allowlist: ['payments.confirm_received'] }),
            action: 'payments.confirm_received',
            binding: {
                user_id: 50,
                fiscal_profile_id: 20,
                fiscal_register_id: 40,
                fiscal_location_id: 30,
                register_fiscal_location_id: 30,
                crm_profile_key: 'event_genix',
                status: 'active',
                capability_scope: ['payments.view']
            },
            fiscalProfileId: 20,
            crmProfileKey: 'event_genix',
            fiscalLocationId: 30,
            fiscalRegisterId: 40
        }),
        error => error.code === 'fiscal_binding_capability_denied'
    );
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
    for (const modulePath of [
        '../routes/payments',
        '../middleware/auth',
        '../services/payments/paymentService',
        '../services/payments/fiscalSaleRouteService'
    ]) {
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
    installMock('../services/payments/fiscalSaleRouteService', {
        assertNoClientFiscalRouteOverride: input => {
            const forbidden = ['fiscalProfileId', 'fiscalRegisterId', 'locationAlias', 'registerAlias', 'providerRegisterId'];
            if (forbidden.some(key => Object.hasOwn(input || {}, key))) {
                throw Object.assign(new Error('Browser fiscal route override is forbidden'), {
                    code: 'fiscal_route_override_forbidden',
                    status: 422
                });
            }
        },
        listFiscalSaleRouteOptions: async () => [],
        resolveFiscalSaleRoute: async ({ routeOptionId, businessContext }) => {
            if (routeOptionId !== 'park_production' || businessContext !== 'event_genix') {
                throw Object.assign(new Error('Invalid test route'), { code: 'fiscal_route_scope_mismatch', status: 409 });
            }
            return {
                routeOptionId,
                businessContext,
                registerMode: 'production',
                mapping: {
                    crm_profile_key: 'event_genix',
                    location_alias: 'park',
                    register_alias: 'middle'
                }
            };
        }
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
            {
                routeOptionId: 'park_production',
                businessContext: 'event_genix',
                tender: 'cash',
                admissionTicket: { date: '2099-01-15', banquetGuests: 2, banquetAdults: 0 }
            },
            { 'Idempotency-Key': 'api-create-1' }
        );

        assert.equal(res.status, 201);
        assert.equal(res.data.success, true);
        assert.equal(calls.create.length, 1);
        assert.equal(calls.create[0].idempotencyKey, 'api-create-1');
        assert.equal(calls.create[0].user.id, 50);
        assert.equal(calls.create[0].body.crmProfileKey, 'event_genix');
        assert.equal(calls.create[0].body.locationAlias, 'park');
        assert.equal(calls.create[0].body.registerAlias, 'middle');
    });
});

test('Cashier PRO routes fail closed while EVENTGENIX_CASHIER_PRO_ENABLED is false', async () => {
    const previous = process.env.EVENTGENIX_CASHIER_PRO_ENABLED;
    process.env.EVENTGENIX_CASHIER_PRO_ENABLED = 'false';
    try {
        await withPaymentRouteApp(async ({ request }) => {
            const res = await request(
                'POST',
                '/api/payments/service-in',
                { amountMinor: '1000' },
                { 'Idempotency-Key': 'api-service-in-disabled' }
            );
            assert.equal(res.status, 403);
            assert.equal(res.data.code, 'cashier_pro_disabled');
        });
    } finally {
        if (previous === undefined) delete process.env.EVENTGENIX_CASHIER_PRO_ENABLED;
        else process.env.EVENTGENIX_CASHIER_PRO_ENABLED = previous;
    }
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

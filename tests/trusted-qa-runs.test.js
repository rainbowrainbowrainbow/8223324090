'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
    TRUSTED_QA_CAPABILITY_STATUS,
    TRUSTED_QA_SIDE_EFFECT_CAPABILITIES,
    TrustedQaRunError,
    cleanupTrustedQaRun,
    createTrustedQaRun,
    endpointAllowed,
    prepareTrustedQaBookingInput,
    qaPublicDetails,
    registerQaEntity,
    requestEndpointKey,
    runTrustedQaCleanupWatchdog,
    sha256,
    trustedQaSideEffectInventory
} = require('../services/trustedQaRuns');

function makeReq({
    token = '',
    requestId = 'qa-request-1',
    path = '/api/bookings',
    method = 'POST',
    userId = 7,
    body = {}
} = {}) {
    const headers = new Map();
    if (token) headers.set('x-disposable-qa-token', token);
    if (requestId) headers.set('x-qa-run-request-id', requestId);
    return {
        method,
        path,
        baseUrl: '',
        body,
        user: { id: userId, username: `user-${userId}` },
        get(name) {
            return headers.get(String(name || '').toLowerCase()) || '';
        }
    };
}

function makeRun(overrides = {}) {
    return {
        id: 11,
        run_id: 'qa-run-11',
        token_hash: sha256('valid-token'),
        source: 'trusted_qa',
        business_context: 'event_genix',
        operator_user_id: 7,
        required_operator_user_id: 7,
        required_user_id: 7,
        required_customer_id: '101',
        required_program_id: '501',
        required_product_id: null,
        required_room_resource_id: 'room-qa',
        required_line_id: 'line-qa',
        allowed_date: new Date('2026-08-14T00:00:00.000Z'),
        allowed_start_time: '12:00:00',
        allowed_end_time: '18:00:00',
        test_customer_marker: 'qa-test-customer',
        allowed_endpoints: ['POST /api/bookings'],
        max_entity_count: 3,
        state: 'active',
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        cleanup_attempts: 0,
        ...overrides
    };
}

function makeBooking(overrides = {}) {
    return {
        id: 'BK-QA-1',
        customerId: 101,
        programId: 501,
        roomResourceId: 'room-qa',
        lineId: 'line-qa',
        date: '2026-08-14',
        time: '13:00',
        duration: 60,
        status: 'confirmed',
        ...overrides
    };
}

const REQUIRED_SIDE_EFFECT_TABLES = TRUSTED_QA_SIDE_EFFECT_CAPABILITIES
    .filter(capability => capability.required)
    .map(capability => capability.tableName);

const DEFAULT_SIDE_EFFECT_COLUMNS = Object.freeze({
    finance_transactions: ['booking_id'],
    receipts: ['booking_id'],
    banquet_deposits: ['primary_booking_id'],
    warehouse_stock_movements: ['source_type', 'source_id', 'status'],
    warehouse_history: ['source_type', 'source_id', 'status'],
    outbox_events: ['source_type', 'source_id', 'status'],
    event_queue: ['source_type', 'source_id', 'status'],
    rule_execution_log: ['source_type', 'source_id', 'status'],
    notification_outbox: ['source_type', 'source_id', 'status'],
    chat_messages: ['source_type', 'source_id', 'status'],
    announcements: ['source_type', 'source_id', 'status'],
    print_jobs: ['source_type', 'source_id', 'status'],
    loyalty_transactions: ['source_type', 'source_id', 'status'],
    gamification_events: ['source_type', 'source_id', 'status']
});

function defaultReadableSideEffectTables() {
    return Object.fromEntries(REQUIRED_SIDE_EFFECT_TABLES.map(tableName => [tableName, 0]));
}

class FakeTrustedQaDb {
    constructor({
        token = 'valid-token',
        run = makeRun(),
        entities = [],
        entityCount = entities.length,
        failBookingCleanup = false,
        flipRunStateBeforeConsume = null,
        sideEffectTables = {},
        sideEffectColumns = {}
    } = {}) {
        this.token = token;
        this.run = { ...run };
        this.entities = entities.map(row => ({ ...row }));
        this.entityCount = entityCount;
        this.failBookingCleanup = failBookingCleanup;
        this.flipRunStateBeforeConsume = flipRunStateBeforeConsume;
        this.sideEffectTables = { ...defaultReadableSideEffectTables(), ...sideEffectTables };
        this.sideEffectColumns = { ...DEFAULT_SIDE_EFFECT_COLUMNS, ...sideEffectColumns };
        this.queries = [];
        this.deletedEventQueueRows = [];
        this.tokenUses = new Set();
        this.cancelledBookingIds = [];
        this.cancelledGroupIds = [];
        this.bookingRows = this.entities
            .filter(row => row.entity_type === 'booking')
            .map(row => ({
                id: row.entity_id,
                business_context: this.run.business_context,
                status: 'confirmed',
                customer_id: this.run.required_customer_id,
                program_id: this.run.required_product_id,
                skip_notification: true,
                extra_data: {
                    disposableQa: {
                        runId: this.run.run_id,
                        source: this.run.source,
                        testCustomerMarker: this.run.test_customer_marker
                    }
                }
            }));
        this.groupRows = this.entities
            .filter(row => row.entity_type === 'banquet_group')
            .map(row => ({ id: row.entity_id, business_context: this.run.business_context, status: 'active' }));
        this.productRows = this.entities
            .filter(row => row.entity_type === 'product')
            .map(row => ({ id: row.entity_id, business_context: this.run.business_context, is_active: true }));
        this.historyWrites = [];
        this.released = false;
        this.cleanedProductIds = [];
        this.transactionAborted = false;
        this.transactionCommitted = false;
        this.savepointSnapshot = null;
    }

    async query(sql, params = []) {
        const normalized = String(sql).replace(/\s+/g, ' ').trim();
        this.queries.push({ sql: normalized, params });

        if (normalized === 'BEGIN') {
            this.transactionAborted = false;
            this.transactionCommitted = false;
            return { rows: [], rowCount: 0 };
        }
        if (normalized === 'ROLLBACK TO SAVEPOINT trusted_qa_cleanup_run') {
            assert.ok(this.savepointSnapshot, 'rollback requires an active cleanup savepoint');
            this.run = { ...this.savepointSnapshot.run };
            this.entities = this.savepointSnapshot.entities.map(row => ({ ...row }));
            this.bookingRows = this.savepointSnapshot.bookingRows.map(row => ({ ...row }));
            this.groupRows = this.savepointSnapshot.groupRows.map(row => ({ ...row }));
            this.productRows = this.savepointSnapshot.productRows.map(row => ({ ...row }));
            this.cancelledBookingIds = [...this.savepointSnapshot.cancelledBookingIds];
            this.cancelledGroupIds = [...this.savepointSnapshot.cancelledGroupIds];
            this.cleanedProductIds = [...this.savepointSnapshot.cleanedProductIds];
            this.transactionAborted = false;
            return { rows: [], rowCount: 0 };
        }
        if (normalized === 'ROLLBACK') {
            this.transactionAborted = false;
            this.savepointSnapshot = null;
            return { rows: [], rowCount: 0 };
        }
        if (this.transactionAborted) {
            const err = new Error('current transaction is aborted, commands ignored until end of transaction block');
            err.code = '25P02';
            throw err;
        }
        if (normalized === 'SAVEPOINT trusted_qa_cleanup_run') {
            this.savepointSnapshot = {
                run: { ...this.run },
                entities: this.entities.map(row => ({ ...row })),
                bookingRows: this.bookingRows.map(row => ({ ...row })),
                groupRows: this.groupRows.map(row => ({ ...row })),
                productRows: this.productRows.map(row => ({ ...row })),
                cancelledBookingIds: [...this.cancelledBookingIds],
                cancelledGroupIds: [...this.cancelledGroupIds],
                cleanedProductIds: [...this.cleanedProductIds]
            };
            return { rows: [], rowCount: 0 };
        }
        if (normalized === 'RELEASE SAVEPOINT trusted_qa_cleanup_run') {
            assert.ok(this.savepointSnapshot, 'release requires an active cleanup savepoint');
            this.savepointSnapshot = null;
            return { rows: [], rowCount: 0 };
        }
        if (normalized === 'COMMIT') {
            this.transactionCommitted = true;
            return { rows: [], rowCount: 0 };
        }
        if (normalized.includes('INSERT INTO trusted_qa_runs')) {
            const row = {
                ...this.run,
                run_id: params[0],
                token_hash: params[1],
                source: params[2],
                business_context: params[3],
                max_entity_count: params[7],
                required_operator_user_id: params[9],
                required_user_id: params[10],
                required_customer_id: params[11],
                required_program_id: params[12],
                required_product_id: params[13],
                required_room_resource_id: params[14],
                required_line_id: params[15],
                allowed_date: params[16],
                allowed_start_time: params[17],
                allowed_end_time: params[18]
            };
            this.run = row;
            return { rows: [row], rowCount: 1 };
        }
        if (normalized.includes('FROM trusted_qa_runs') && normalized.includes('token_hash = $1')) {
            const expiresAt = Date.parse(this.run.expires_at || '');
            const matches = params[0] === sha256(this.token)
                && params[1] === this.run.business_context
                && this.run.state === 'active'
                && Number.isFinite(expiresAt)
                && expiresAt > Date.now();
            return { rows: matches ? [{ ...this.run }] : [], rowCount: matches ? 1 : 0 };
        }
        if (normalized.includes('SET token_use_count')) {
            if (this.flipRunStateBeforeConsume) {
                this.run.state = this.flipRunStateBeforeConsume;
                this.flipRunStateBeforeConsume = null;
            }
            const expiresAt = Date.parse(this.run.expires_at || '');
            const claimable = Number(params[0]) === Number(this.run.id)
                && this.run.state === 'active'
                && Number.isFinite(expiresAt)
                && expiresAt > Date.now();
            if (!claimable) return { rows: [], rowCount: 0 };
            this.run.token_use_count = Number(this.run.token_use_count || 0) + 1;
            return { rows: [{ id: this.run.id }], rowCount: 1 };
        }
        if (normalized.includes('INSERT INTO trusted_qa_run_token_uses')) {
            const key = `${params[0]}:${params[1]}`;
            if (this.tokenUses.has(key)) return { rows: [], rowCount: 0 };
            this.tokenUses.add(key);
            return { rows: [{ id: this.tokenUses.size }], rowCount: 1 };
        }
        if (normalized.includes('SELECT COUNT(*)::int AS count FROM trusted_qa_run_entities')) {
            return { rows: [{ count: this.entityCount }], rowCount: 1 };
        }
        if (normalized.includes('FROM trusted_qa_run_entities')
            && normalized.includes('entity_type = $2')
            && normalized.includes('entity_id = $3')) {
            const match = this.entities.find(row => Number(row.run_id) === Number(params[0])
                && row.entity_type === params[1]
                && row.entity_id === params[2]);
            return { rows: match ? [{ id: match.id }] : [], rowCount: match ? 1 : 0 };
        }
        if (normalized.includes('INSERT INTO trusted_qa_run_entities')) {
            const existing = this.entities.find(row => Number(row.run_id) === Number(params[0])
                && row.entity_type === params[1]
                && row.entity_id === params[2]);
            if (existing) {
                existing.payload = JSON.parse(params[3]);
                return { rows: [{ id: existing.id }], rowCount: 1 };
            }
            this.entityCount += 1;
            this.entities.push({
                id: this.entities.length + 1,
                run_id: params[0],
                entity_type: params[1],
                entity_id: params[2],
                payload: JSON.parse(params[3]),
                cleanup_state: 'active'
            });
            return { rows: [{ id: this.entities.length }], rowCount: 1 };
        }
        if (normalized.includes('FROM trusted_qa_runs') && normalized.includes('WHERE id = $1')) {
            return { rows: Number(params[0]) === Number(this.run.id) ? [this.run] : [], rowCount: 1 };
        }
        if (normalized.includes('FROM trusted_qa_run_entities')) {
            return { rows: this.entities.filter(row => Number(row.run_id) === Number(params[0])), rowCount: this.entities.length };
        }
        if (normalized.includes('FROM bookings') && normalized.includes('FOR UPDATE')) {
            const ids = params[0] || [];
            const rows = this.bookingRows.filter(row => ids.includes(row.id));
            return { rows, rowCount: rows.length };
        }
        if (normalized.includes('FROM banquet_groups') && normalized.includes('FOR UPDATE')) {
            const ids = params[0] || [];
            const rows = this.groupRows.filter(row => ids.includes(row.id));
            return { rows, rowCount: rows.length };
        }
        if (normalized.startsWith('SELECT id FROM tasks')) {
            return { rows: [], rowCount: 0 };
        }
        if (normalized.startsWith('SELECT to_regclass')) {
            const value = this.sideEffectTables[params[0]];
            if (value?.relationError) throw value.relationError;
            return {
                rows: [{ relation_name: Object.hasOwn(this.sideEffectTables, params[0]) && value !== 'absent' ? params[0] : null }],
                rowCount: 1
            };
        }
        if (normalized.includes('FROM information_schema.columns')) {
            const tableName = params[0];
            const value = this.sideEffectTables[tableName];
            if (value?.columnsError) throw value.columnsError;
            const columns = value?.columns || this.sideEffectColumns[tableName] || [];
            return {
                rows: columns.map((column_name, index) => ({ column_name, ordinal_position: index + 1 })),
                rowCount: columns.length
            };
        }
        if (normalized.includes('WITH manifest_products AS')) {
            const productIds = params[0] || [];
            const stockValue = this.sideEffectTables.product_stock_requirements || 0;
            return {
                rows: [{
                    product_count: this.productRows.filter(row => productIds.includes(row.id)).length,
                    stock_requirement_count: Number(stockValue?.count ?? stockValue ?? 0)
                }],
                rowCount: 1
            };
        }
        if (normalized.includes('DELETE FROM event_queue row_value')) {
            const value = this.sideEffectTables.event_queue || 0;
            const rows = Array.isArray(value)
                ? value
                : (Array.isArray(value?.rows) ? value.rows
                : Array.from({ length: Number(value || 0) }, (_, index) => ({
                    id: index + 1,
                    event_type: 'booking.cancelled',
                    status: 'processed'
                })));
            this.deletedEventQueueRows.push(...rows);
            this.sideEffectTables.event_queue = 0;
            return { rows, rowCount: rows.length };
        }
        const structuredSideEffectMatch = normalized.match(/FROM "([a-z_]+)" WHERE/);
        if (structuredSideEffectMatch) {
            const tableName = structuredSideEffectMatch[1];
            const value = this.sideEffectTables[tableName] || 0;
            if (value?.queryError) throw value.queryError;
            const rows = Array.isArray(value)
                ? value
                : (Array.isArray(value?.rows) ? value.rows
                    : Array.from({ length: Number(value?.count ?? value ?? 0) }, () => ({ status: 'pending' })));
            const terminal = new Set(['processed', 'done', 'completed', 'complete', 'archived', 'cleaned', 'cancelled', 'canceled', 'closed', 'resolved', 'sent', 'delivered', 'skipped', 'ignored']);
            const active = rows.filter(row => !terminal.has(String(row.status || 'pending').toLowerCase()));
            return {
                rows: [{
                    exact_count: rows.length,
                    active_count: active.length,
                    processed_historical_count: rows.length - active.length
                }],
                rowCount: 1
            };
        }
        const sideEffectMatch = normalized.match(/FROM ([a-z_]+) row_value/);
        if (sideEffectMatch) {
            const value = this.sideEffectTables[sideEffectMatch[1]] || 0;
            const count = Array.isArray(value) ? value.length : Number(value || 0);
            return { rows: [{ count }], rowCount: 1 };
        }
        if (normalized.includes('UPDATE bookings SET status =')) {
            if (this.failBookingCleanup) {
                const err = new Error('simulated cleanup transport failure');
                err.code = 'SIMULATED_CLEANUP_FAILURE';
                this.transactionAborted = true;
                throw err;
            }
            this.cancelledBookingIds.push(...params[0]);
            this.bookingRows = this.bookingRows.map(row => params[0].includes(row.id)
                ? { ...row, status: 'cancelled' }
                : row);
            return { rows: [], rowCount: params[0].length };
        }
        if (normalized.includes('UPDATE banquet_groups SET status =')) {
            this.cancelledGroupIds.push(...params[0]);
            this.groupRows = this.groupRows.map(row => params[0].includes(row.id)
                ? { ...row, status: 'cancelled' }
                : row);
            return { rows: [], rowCount: params[0].length };
        }
        if (normalized.includes('UPDATE products SET is_active = false')) {
            this.cleanedProductIds.push(...params[0]);
            this.productRows = this.productRows.map(row => params[0].includes(row.id)
                ? { ...row, is_active: false }
                : row);
            return { rows: [], rowCount: params[0].length };
        }
        if (normalized.includes('SELECT COUNT(*)::int AS count FROM bookings')) {
            const count = this.bookingRows.filter(row => (params[0] || []).includes(row.id) && row.status !== 'cancelled').length;
            return { rows: [{ count }], rowCount: 1 };
        }
        if (normalized.includes('SELECT COUNT(*)::int AS count FROM banquet_groups')) {
            const count = this.groupRows.filter(row => (params[0] || []).includes(row.id) && row.status !== 'cancelled').length;
            return { rows: [{ count }], rowCount: 1 };
        }
        if (normalized.includes('SELECT COUNT(*)::int AS count FROM products')) {
            const count = this.productRows.filter(row => (params[0] || []).includes(row.id) && row.is_active).length;
            return { rows: [{ count }], rowCount: 1 };
        }
        if (normalized.includes('UPDATE trusted_qa_run_entities SET cleanup_state')) {
            this.entities = this.entities.map(row => Number(row.run_id) === Number(params[0])
                ? { ...row, cleanup_state: 'cleaned' }
                : row);
            return { rows: [], rowCount: this.entities.length };
        }
        if (normalized.includes("SET state = 'cleaned'")) {
            this.run.state = 'cleaned';
            this.run.cleaned_at = this.run.cleaned_at || new Date().toISOString();
            return { rows: [this.run], rowCount: 1 };
        }
        if (normalized.includes('FROM trusted_qa_runs') && normalized.includes('FOR UPDATE SKIP LOCKED')) {
            const now = Date.now();
            const nextCleanupAt = Date.parse(this.run.next_cleanup_at || '');
            const expiresAt = Date.parse(this.run.expires_at || '');
            const cleanupPendingReady = this.run.state === 'cleanup_pending'
                && (!Number.isFinite(nextCleanupAt) || nextCleanupAt <= now);
            const expiredActive = this.run.state === 'active'
                && Number.isFinite(expiresAt)
                && expiresAt <= now;
            const selectable = Number(this.run.cleanup_attempts || 0) < Number(params[0])
                && (cleanupPendingReady || expiredActive);
            return { rows: selectable ? [{ ...this.run }] : [], rowCount: selectable ? 1 : 0 };
        }
        if (normalized.includes('cleanup_last_error = $2')) {
            this.run.cleanup_attempts = Number(this.run.cleanup_attempts || 0) + 1;
            this.run.cleanup_last_attempt_at = new Date().toISOString();
            this.run.cleanup_last_error = params[1];
            this.run.state = Number(this.run.cleanup_attempts || 0) >= Number(params[2]) ? 'blocked' : 'cleanup_pending';
            if (this.run.state === 'blocked') this.run.blocked_reason = params[1];
            return { rows: [this.run], rowCount: 1 };
        }
        if (normalized.includes('SET cleanup_attempts = COALESCE(cleanup_attempts, 0) + 1')) {
            this.run.cleanup_attempts = Number(this.run.cleanup_attempts || 0) + 1;
            this.run.cleanup_last_attempt_at = new Date().toISOString();
            return { rows: [this.run], rowCount: 1 };
        }
        if (normalized.includes('INSERT INTO history')) {
            this.historyWrites.push(params);
            return { rows: [], rowCount: 1 };
        }
        throw new Error(`Unhandled fake query: ${normalized}`);
    }

    release() {
        this.released = true;
    }
}

test('client-supplied disposable QA marker is rejected before any entity write', async () => {
    const db = new FakeTrustedQaDb();
    const req = makeReq();
    const booking = makeBooking({
        extraData: {
            disposableQa: {
                schemaVersion: 1,
                runId: 'fake-run',
                source: 'timeline_browser_smoke',
                cleanupExpected: true,
                testCustomerMarker: 'fake',
                kind: 'booking',
                createdAt: new Date().toISOString()
            }
        }
    });

    await assert.rejects(
        () => prepareTrustedQaBookingInput(db, req, booking, 'event_genix'),
        err => err instanceof TrustedQaRunError && err.code === 'QA_MARKER_UNTRUSTED'
    );
    assert.equal(db.queries.length, 0);
});

test('client-supplied trusted QA attribution marker is rejected without a server token', async () => {
    const db = new FakeTrustedQaDb();
    const booking = makeBooking({
        skipNotification: true,
        extraData: {
            disposableQa: {
                schemaVersion: 1,
                runId: 'qa-run-attacker',
                source: 'trusted_qa',
                cleanupExpected: true,
                testCustomerMarker: 'qa-test-customer',
                kind: 'booking',
                createdAt: new Date().toISOString()
            }
        }
    });

    await assert.rejects(
        () => prepareTrustedQaBookingInput(db, makeReq(), booking, 'event_genix'),
        err => err instanceof TrustedQaRunError && err.code === 'QA_MARKER_UNTRUSTED'
    );
    assert.equal(booking.skipNotification, true, 'rejected input should not be normalized into an authorized QA write');
    assert.equal(db.queries.length, 0);
});

test('invalid token is rejected without registration or side-effect suppression', async () => {
    const db = new FakeTrustedQaDb({ token: 'other-token' });
    const req = makeReq({ token: 'invalid-token' });

    await assert.rejects(
        () => prepareTrustedQaBookingInput(db, req, makeBooking(), 'event_genix'),
        err => err instanceof TrustedQaRunError && err.code === 'QA_RUN_TOKEN_INVALID'
    );
    assert.equal(db.entities.length, 0);
});

test('client skipNotification flag is ignored without a trusted QA token', async () => {
    const db = new FakeTrustedQaDb();
    const booking = makeBooking({ skipNotification: true, skip_notification: true });
    const context = await prepareTrustedQaBookingInput(db, makeReq(), booking, 'event_genix');

    assert.equal(context.trusted, false);
    assert.equal(context.suppressSideEffects, false);
    assert.equal(booking.skipNotification, false);
    assert.equal(booking.skip_notification, false);
    assert.equal(db.queries.length, 0);
});

test('root booking route normalizes to the exact allowlisted endpoint without trailing slash', () => {
    const req = {
        method: 'POST',
        baseUrl: '/api/bookings',
        route: { path: '/' }
    };
    assert.equal(requestEndpointKey(req), 'POST /api/bookings');
    assert.equal(endpointAllowed(requestEndpointKey(req), ['POST /api/bookings']), true);
});

test('valid trusted QA token attaches server marker and consumes request id once', async () => {
    const db = new FakeTrustedQaDb();
    const req = makeReq({ token: 'valid-token', requestId: 'req-1' });
    const booking = makeBooking();

    const context = await prepareTrustedQaBookingInput(db, req, booking, 'event_genix');

    assert.equal(context.trusted, true);
    assert.equal(context.suppressSideEffects, true);
    assert.equal(booking.skipNotification, true);
    assert.equal(booking.extraData.disposableQa.source, 'trusted_qa');
    assert.equal(booking.extraData.disposableQa.runId, 'qa-run-11');
    assert.equal(db.tokenUses.size, 1);
    assert.equal(db.queries.some(entry => entry.params.includes('valid-token')), false);
});

test('token consumption fails closed when cleanup wins after the initial active read', async () => {
    const db = new FakeTrustedQaDb({ flipRunStateBeforeConsume: 'cleaned' });
    const booking = makeBooking();

    await assert.rejects(
        () => prepareTrustedQaBookingInput(
            db,
            makeReq({ token: 'valid-token', requestId: 'cleanup-race' }),
            booking,
            'event_genix'
        ),
        err => err instanceof TrustedQaRunError && err.code === 'QA_RUN_NOT_ACTIVE'
    );

    const lifecycleClaim = db.queries.find(entry => entry.sql.includes('SET token_use_count'));
    assert.ok(lifecycleClaim, 'consume must make an authoritative lifecycle claim');
    assert.match(lifecycleClaim.sql, /state = 'active'/);
    assert.match(lifecycleClaim.sql, /expires_at > NOW\(\)/);
    assert.equal(db.run.state, 'cleaned');
    assert.equal(Number(db.run.token_use_count || 0), 0);
    assert.equal(db.tokenUses.size, 0);
    assert.equal(booking.extraData, undefined);
    assert.equal(booking.skipNotification, undefined);
});

test('replayed QA request id is rejected', async () => {
    const db = new FakeTrustedQaDb();
    await prepareTrustedQaBookingInput(db, makeReq({ token: 'valid-token', requestId: 'same-req' }), makeBooking(), 'event_genix');

    await assert.rejects(
        () => prepareTrustedQaBookingInput(db, makeReq({ token: 'valid-token', requestId: 'same-req' }), makeBooking({ id: 'BK-QA-2' }), 'event_genix'),
        err => err instanceof TrustedQaRunError && err.code === 'QA_RUN_TOKEN_REPLAYED'
    );
});

test('child bookings reuse token but still must match exact QA constraints', async () => {
    const db = new FakeTrustedQaDb();
    const req = makeReq({ token: 'valid-token', requestId: 'req-child' });
    await prepareTrustedQaBookingInput(db, req, makeBooking({ id: 'BK-QA-main' }), 'event_genix');

    await assert.rejects(
        () => prepareTrustedQaBookingInput(db, req, makeBooking({ id: 'BK-QA-child', roomResourceId: 'wrong-room' }), 'event_genix'),
        err => err instanceof TrustedQaRunError && err.code === 'QA_RUN_ROOM_MISMATCH'
    );
    assert.equal(db.tokenUses.size, 1);
});

test('trusted QA token is bound to the exact line, date, and complete time window', async () => {
    for (const [booking, code] of [
        [makeBooking({ lineId: 'line-other' }), 'QA_RUN_LINE_MISMATCH'],
        [makeBooking({ date: '2026-08-15' }), 'QA_RUN_DATE_MISMATCH'],
        [makeBooking({ time: '11:59' }), 'QA_RUN_TIME_WINDOW_MISMATCH'],
        [makeBooking({ time: '17:30', duration: 60 }), 'QA_RUN_TIME_WINDOW_MISMATCH']
    ]) {
        const db = new FakeTrustedQaDb();
        await assert.rejects(
            () => prepareTrustedQaBookingInput(db, makeReq({ token: 'valid-token' }), booking, 'event_genix'),
            err => err instanceof TrustedQaRunError && err.code === code
        );
        assert.equal(db.tokenUses.size, 0);
    }
});

test('registered entity IDs are stored atomically and enforce max count', async () => {
    const db = new FakeTrustedQaDb();
    const context = await prepareTrustedQaBookingInput(db, makeReq({ token: 'valid-token', requestId: 'req-register' }), makeBooking(), 'event_genix');

    await registerQaEntity(db, context, 'booking', 'BK-QA-1', { businessContext: 'event_genix' });
    await registerQaEntity(db, context, 'booking', 'BK-QA-2', { businessContext: 'event_genix' });
    await registerQaEntity(db, context, 'booking', 'BK-QA-3', { businessContext: 'event_genix' });

    await assert.rejects(
        () => registerQaEntity(db, context, 'booking', 'BK-QA-4', { businessContext: 'event_genix' }),
        err => err instanceof TrustedQaRunError && err.code === 'QA_RUN_ENTITY_LIMIT_EXCEEDED'
    );
    assert.deepEqual(db.entities.map(row => row.entity_id), ['BK-QA-1', 'BK-QA-2', 'BK-QA-3']);
});

test('duplicate or concurrent entity registration is idempotent and does not inflate manifest count', async () => {
    const db = new FakeTrustedQaDb();
    const context = await prepareTrustedQaBookingInput(db, makeReq({ token: 'valid-token', requestId: 'req-duplicate-register' }), makeBooking(), 'event_genix');

    const first = await registerQaEntity(db, context, 'booking', 'BK-QA-1', { businessContext: 'event_genix', attempt: 1 });
    const second = await registerQaEntity(db, context, 'booking', 'BK-QA-1', { businessContext: 'event_genix', attempt: 2 });

    assert.deepEqual(first, { registered: true, entityId: 'BK-QA-1', existed: false });
    assert.deepEqual(second, { registered: true, entityId: 'BK-QA-1', existed: true });
    assert.equal(db.entities.length, 1);
    assert.equal(db.entityCount, 1);
    assert.equal(db.entities[0].payload.attempt, 2);
});

test('cleanup is exact-manifest driven, cancels registered bookings/groups and is idempotent', async () => {
    const db = new FakeTrustedQaDb({
        entities: [
            { id: 1, run_id: 11, entity_type: 'booking', entity_id: 'BK-QA-1', cleanup_state: 'active' },
            { id: 2, run_id: 11, entity_type: 'booking', entity_id: 'BK-QA-2', cleanup_state: 'active' },
            { id: 3, run_id: 11, entity_type: 'banquet_group', entity_id: 'BQ-QA-1', cleanup_state: 'active' }
        ]
    });

    const first = await cleanupTrustedQaRun(db, 11);
    const second = await cleanupTrustedQaRun(db, 11);

    assert.equal(first.status, 'cleaned');
    assert.deepEqual(first.cleanedBookingIds, ['BK-QA-1', 'BK-QA-2']);
    assert.deepEqual(first.cleanedGroupIds, ['BQ-QA-1']);
    assert.deepEqual(db.cancelledBookingIds, ['BK-QA-1', 'BK-QA-2']);
    assert.deepEqual(db.cancelledGroupIds, ['BQ-QA-1']);
    assert.equal(db.entities.every(row => row.cleanup_state === 'cleaned'), true);
    assert.equal(second.idempotent, true);
});

test('cleanup keeps processed trusted QA event queue rows as historical evidence', async () => {
    const db = new FakeTrustedQaDb({
        entities: [
            { id: 1, run_id: 11, entity_type: 'booking', entity_id: 'BK-QA-1', cleanup_state: 'active' }
        ],
        sideEffectTables: {
            event_queue: [
                { id: 1939, event_type: 'booking.cancelled', status: 'processed' },
                { id: 1940, event_type: 'booking.cancelled', status: 'processed' }
            ]
        }
    });

    const result = await cleanupTrustedQaRun(db, 11);

    assert.equal(result.status, 'cleaned');
    assert.deepEqual(result.purgedEventQueueIds, []);
    assert.deepEqual(db.deletedEventQueueRows, []);
    assert.equal(result.sideEffectCounts.event_queue, 0);
    assert.equal(result.sideEffectExactCounts.event_queue, 2);
    assert.equal(result.sideEffectProcessedHistoricalCounts.event_queue, 2);
});

test('cleanup supports product-only trusted QA run before bookings are created', async () => {
    const db = new FakeTrustedQaDb({
        entities: [
            { id: 1, run_id: 11, entity_type: 'product', entity_id: 'qa-product-only', cleanup_state: 'active' }
        ],
        sideEffectColumns: {
            ...DEFAULT_SIDE_EFFECT_COLUMNS,
            outbox_events: ['correlation_id', 'status']
        }
    });

    const result = await cleanupTrustedQaRun(db, 11);
    const unsupportedRequired = result.sideEffectInventory.filter(item => (
        item.required
        && item.status === TRUSTED_QA_CAPABILITY_STATUS.UNSUPPORTED
    ));

    assert.equal(result.status, 'cleaned');
    assert.deepEqual(result.cleanedBookingIds, []);
    assert.deepEqual(result.cleanedGroupIds, []);
    assert.deepEqual(result.cleanedProductIds, ['qa-product-only']);
    assert.deepEqual(db.cleanedProductIds, ['qa-product-only']);
    assert.equal(db.run.state, 'cleaned');
    assert.equal(unsupportedRequired.every(item => item.blocking === false), true);
    assert.equal(unsupportedRequired.every(item => item.error?.reason === 'no_booking_or_group_scope'), true);
    assert.ok(
        db.queries.some(entry => /FROM "outbox_events" WHERE/.test(entry.sql) && entry.params.length === 1),
        'structured side-effect query should use compact dynamic params'
    );
});

test('cleanup blocks unsupported no-attribution tables when booking scope exists', async () => {
    const db = new FakeTrustedQaDb({
        entities: [
            { id: 1, run_id: 11, entity_type: 'product', entity_id: 'qa-no-stock-product', cleanup_state: 'active' },
            { id: 2, run_id: 11, entity_type: 'booking', entity_id: 'BK-QA-1', cleanup_state: 'active' }
        ],
        sideEffectTables: {
            product_stock_requirements: 0
        },
        sideEffectColumns: {
            ...DEFAULT_SIDE_EFFECT_COLUMNS,
            warehouse_stock_movements: ['business_context'],
            notification_outbox: ['status']
        }
    });

    await assert.rejects(
        cleanupTrustedQaRun(db, 11),
        error => error?.code === 'QA_RUN_SIDE_EFFECT_VISIBILITY_BLOCKER'
            && error.details.capabilities.some(item => item.tableName === 'warehouse_stock_movements')
            && error.details.capabilities.some(item => item.tableName === 'notification_outbox')
    );
    assert.deepEqual(db.cancelledBookingIds, [], 'cleanup must stop before mutating bookings when visibility is incomplete');
});

test('side-effect inventory separates processed historical evidence from active leftovers', async () => {
    const db = new FakeTrustedQaDb({
        entities: [
            { id: 1, run_id: 11, entity_type: 'booking', entity_id: 'BK-QA-1', cleanup_state: 'active' }
        ],
        sideEffectTables: {
            outbox_events: [{ status: 'processed' }],
            notification_outbox: [{ status: 'pending' }]
        }
    });
    const inventory = {
        run: db.run,
        entities: db.entities
    };

    const result = await trustedQaSideEffectInventory(db, inventory, ['BK-QA-1'], []);
    const outbox = result.capabilities.find(item => item.tableName === 'outbox_events');
    const notifications = result.capabilities.find(item => item.tableName === 'notification_outbox');

    assert.equal(outbox.status, TRUSTED_QA_CAPABILITY_STATUS.READABLE);
    assert.equal(outbox.exactCount, 1);
    assert.equal(outbox.activeCount, 0);
    assert.equal(outbox.processedHistoricalCount, 1);
    assert.equal(outbox.blocking, false);
    assert.equal(notifications.activeCount, 1);
    assert.equal(result.total, 1);
});

test('side-effect inventory detects trusted QA public-id attributed leftovers', async () => {
    const db = new FakeTrustedQaDb({
        entities: [
            { id: 1, run_id: 11, entity_type: 'booking', entity_id: 'BK-QA-1', cleanup_state: 'active' }
        ],
        sideEffectColumns: {
            ...DEFAULT_SIDE_EFFECT_COLUMNS,
            warehouse_stock_movements: ['trusted_qa_run_public_id', 'status'],
            warehouse_history: ['trusted_qa_run_public_id', 'status'],
            rule_execution_log: ['trusted_qa_run_public_id', 'status'],
            notification_outbox: ['trusted_qa_run_public_id', 'status'],
            chat_messages: ['trusted_qa_run_public_id', 'status'],
            announcements: ['trusted_qa_run_public_id', 'status']
        },
        sideEffectTables: {
            warehouse_stock_movements: [{ trusted_qa_run_public_id: 'qa-run-11', status: 'pending' }],
            warehouse_history: [{ trusted_qa_run_public_id: 'qa-run-11', status: 'archived' }],
            rule_execution_log: 0,
            notification_outbox: 0,
            chat_messages: 0,
            announcements: 0
        }
    });
    const inventory = {
        run: db.run,
        entities: db.entities
    };

    const result = await trustedQaSideEffectInventory(db, inventory, ['BK-QA-1'], []);
    const stock = result.capabilities.find(item => item.tableName === 'warehouse_stock_movements');
    const history = result.capabilities.find(item => item.tableName === 'warehouse_history');

    assert.equal(stock.status, TRUSTED_QA_CAPABILITY_STATUS.READABLE);
    assert.deepEqual(stock.attributionMethod, ['trusted_qa_run_public_id']);
    assert.equal(stock.activeCount, 1);
    assert.equal(stock.blocking, true);
    assert.equal(history.processedHistoricalCount, 1);
    assert.equal(result.total, 1);
    assert.ok(
        db.queries.some(entry => /FROM "warehouse_stock_movements" WHERE/.test(entry.sql)
            && entry.params.includes('qa-run-11')),
        'inventory must query durable trusted_qa_run_public_id'
    );
});

test('migration 336 adds durable trusted QA attribution to supported side-effect tables', () => {
    const migration = fs.readFileSync(
        path.join(__dirname, '..', 'db', 'migrations', '336_trusted_qa_side_effect_attribution.sql'),
        'utf8'
    );
    for (const table of [
        'warehouse_stock_movements',
        'warehouse_history',
        'rule_execution_log',
        'notification_outbox',
        'chat_messages',
        'announcements'
    ]) {
        assert.match(migration, new RegExp(`'${table}'`));
        assert.match(migration, /ADD COLUMN IF NOT EXISTS trusted_qa_run_id BIGINT/);
        assert.match(migration, /ADD COLUMN IF NOT EXISTS trusted_qa_run_entity_id BIGINT/);
        assert.match(migration, /ADD COLUMN IF NOT EXISTS trusted_qa_run_public_id VARCHAR\(100\)/);
        assert.match(migration, /NOT VALID/);
    }
    assert.doesNotMatch(migration, /\bUPDATE\b|\bDELETE\s+FROM\b|\bVALIDATE\s+CONSTRAINT\b/i);
});

test('trusted QA side-effect writers preserve public attribution when a row is emitted', () => {
    const eventBus = fs.readFileSync(path.join(__dirname, '..', 'services', 'eventBus.js'), 'utf8');
    const notificationOutbox = fs.readFileSync(path.join(__dirname, '..', 'services', 'notificationOutbox.js'), 'utf8');
    const bookingRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'bookings.js'), 'utf8');

    assert.match(eventBus, /trustedQaRunPublicIdFromPayload/);
    assert.match(eventBus, /isTrustedDisposableQaSource\(disposableQa\.source\)/);
    assert.match(eventBus, /INSERT INTO rule_execution_log[\s\S]*trusted_qa_run_public_id/);
    assert.match(eventBus, /INSERT INTO chat_messages[\s\S]*trusted_qa_run_public_id/);
    assert.match(notificationOutbox, /trustedQaRunPublicIdFromNotificationPayload/);
    assert.match(notificationOutbox, /INSERT INTO notification_outbox[\s\S]*trusted_qa_run_public_id/);
    assert.match(notificationOutbox, /isTrustedDisposableQaSource\(disposableQa\?\.source\)/);
    assert.match(bookingRoutes, /trustedQaRunPublicIdFromBooking/);
    assert.match(bookingRoutes, /INSERT INTO warehouse_history[\s\S]*trusted_qa_run_public_id/);
    assert.match(bookingRoutes, /INSERT INTO announcements[\s\S]*trusted_qa_run_public_id/);
});

test('side-effect inventory classifies optional absent capabilities as non-blocking', async () => {
    const db = new FakeTrustedQaDb();
    const inventory = {
        run: db.run,
        entities: [{ id: 1, run_id: 11, entity_type: 'booking', entity_id: 'BK-QA-1', cleanup_state: 'active' }]
    };

    const result = await trustedQaSideEffectInventory(db, inventory, ['BK-QA-1'], []);
    const loyalty = result.capabilities.find(item => item.tableName === 'loyalty_transactions');
    const gamification = result.capabilities.find(item => item.tableName === 'gamification_events');

    assert.equal(loyalty.status, TRUSTED_QA_CAPABILITY_STATUS.ABSENT);
    assert.equal(loyalty.required, false);
    assert.equal(loyalty.blocking, false);
    assert.equal(gamification.status, TRUSTED_QA_CAPABILITY_STATUS.ABSENT);
    assert.equal(gamification.blocking, false);
});

test('side-effect inventory blocks required visibility failures instead of treating them as zero', async () => {
    const permissionError = new Error('permission denied for table notification_outbox');
    permissionError.code = '42501';
    const db = new FakeTrustedQaDb({
        entities: [
            { id: 1, run_id: 11, entity_type: 'booking', entity_id: 'BK-QA-1', cleanup_state: 'active' }
        ],
        sideEffectTables: {
            notification_outbox: { relationError: permissionError }
        }
    });
    const inventory = {
        run: db.run,
        entities: db.entities
    };

    const result = await trustedQaSideEffectInventory(db, inventory, ['BK-QA-1'], []);
    const notifications = result.capabilities.find(item => item.tableName === 'notification_outbox');

    assert.equal(notifications.status, TRUSTED_QA_CAPABILITY_STATUS.PERMISSION_DENIED);
    assert.equal(notifications.blocking, true);
    assert.equal(result.visibilityBlockers.length, 1);
});

test('cleanup fails closed when required side-effect visibility is incomplete', async () => {
    const permissionError = new Error('permission denied for table notification_outbox');
    permissionError.code = '42501';
    const db = new FakeTrustedQaDb({
        entities: [
            { id: 1, run_id: 11, entity_type: 'booking', entity_id: 'BK-QA-1', cleanup_state: 'active' }
        ],
        sideEffectTables: {
            notification_outbox: { relationError: permissionError }
        }
    });

    await assert.rejects(
        () => cleanupTrustedQaRun(db, 11),
        err => err instanceof TrustedQaRunError && err.code === 'QA_RUN_SIDE_EFFECT_VISIBILITY_BLOCKER'
    );
    assert.deepEqual(db.cancelledBookingIds, []);
});

test('watchdog atomically cleans an expired active run through its exact entity manifest', async () => {
    const db = new FakeTrustedQaDb({
        run: makeRun({
            state: 'active',
            expires_at: new Date(Date.now() - 60_000).toISOString(),
            cleanup_attempts: 0
        }),
        entities: [
            { id: 1, run_id: 11, entity_type: 'booking', entity_id: 'BK-QA-1', cleanup_state: 'active' }
        ]
    });

    const result = await runTrustedQaCleanupWatchdog({ client: db, maxAttempts: 3 });

    assert.equal(result.processed, 1);
    assert.deepEqual(result.runs, [{ runId: 'qa-run-11', status: 'cleaned', state: 'cleaned' }]);
    assert.equal(db.run.state, 'cleaned');
    assert.equal(db.run.cleanup_attempts, 1);
    assert.deepEqual(db.cancelledBookingIds, ['BK-QA-1']);
    assert.equal(db.entities[0].cleanup_state, 'cleaned');
    assert.ok(db.queries.some(entry => entry.sql.includes('FOR UPDATE SKIP LOCKED')));
});

test('watchdog leaves a non-expired active run untouched', async () => {
    const db = new FakeTrustedQaDb({
        run: makeRun({
            state: 'active',
            expires_at: new Date(Date.now() + 60_000).toISOString(),
            cleanup_attempts: 0
        }),
        entities: [
            { id: 1, run_id: 11, entity_type: 'booking', entity_id: 'BK-QA-1', cleanup_state: 'active' }
        ]
    });

    const result = await runTrustedQaCleanupWatchdog({ client: db, maxAttempts: 3 });

    assert.deepEqual(result, { processed: 0, runs: [] });
    assert.equal(db.run.state, 'active');
    assert.equal(db.run.cleanup_attempts, 0);
    assert.deepEqual(db.cancelledBookingIds, []);
    assert.equal(db.entities[0].cleanup_state, 'active');
});

test('watchdog preserves ready cleanup_pending cleanup semantics', async () => {
    const db = new FakeTrustedQaDb({
        run: makeRun({
            state: 'cleanup_pending',
            next_cleanup_at: new Date(Date.now() - 60_000).toISOString(),
            cleanup_attempts: 0
        }),
        entities: [
            { id: 1, run_id: 11, entity_type: 'booking', entity_id: 'BK-QA-1', cleanup_state: 'active' }
        ]
    });

    const result = await runTrustedQaCleanupWatchdog({ client: db, maxAttempts: 3 });

    assert.equal(result.processed, 1);
    assert.equal(result.runs[0].status, 'cleaned');
    assert.equal(db.run.state, 'cleaned');
    assert.deepEqual(db.cancelledBookingIds, ['BK-QA-1']);
});

test('watchdog rolls back a SQL-aborted cleanup to its savepoint and commits retry metadata', async () => {
    const db = new FakeTrustedQaDb({
        run: makeRun({ state: 'cleanup_pending', cleanup_attempts: 0 }),
        entities: [
            { id: 1, run_id: 11, entity_type: 'booking', entity_id: 'BK-QA-1', cleanup_state: 'active' }
        ],
        failBookingCleanup: true
    });

    const result = await runTrustedQaCleanupWatchdog({ client: db, maxAttempts: 3 });
    const statements = db.queries.map(entry => entry.sql);
    const rollbackToIndex = statements.indexOf('ROLLBACK TO SAVEPOINT trusted_qa_cleanup_run');
    const retryUpdateIndex = statements.findIndex(statement => statement.includes('cleanup_last_error = $2'));

    assert.equal(result.processed, 1);
    assert.equal(result.runs[0].status, 'retry_scheduled');
    assert.equal(db.run.cleanup_attempts, 1);
    assert.equal(db.run.state, 'cleanup_pending');
    assert.match(db.run.cleanup_last_error, /simulated cleanup transport failure/);
    assert.equal(db.transactionCommitted, true);
    assert.ok(rollbackToIndex > -1);
    assert.ok(retryUpdateIndex > rollbackToIndex, 'retry metadata must be written after savepoint recovery');
    assert.equal(statements.at(-1), 'COMMIT');
});

test('watchdog retries cleanup_pending and blocks after bounded failures', async () => {
    const db = new FakeTrustedQaDb({
        run: makeRun({ state: 'cleanup_pending', cleanup_attempts: 0 }),
        entities: [
            { id: 1, run_id: 11, entity_type: 'booking', entity_id: 'BK-QA-1', cleanup_state: 'active' }
        ],
        failBookingCleanup: true
    });

    const result = await runTrustedQaCleanupWatchdog({ client: db, maxAttempts: 1 });

    assert.equal(result.processed, 1);
    assert.equal(result.runs[0].status, 'retry_scheduled');
    assert.equal(db.run.cleanup_attempts, 1);
    assert.equal(db.run.state, 'blocked');
    assert.match(db.run.cleanup_last_error, /simulated cleanup transport failure/);
    assert.match(db.run.blocked_reason, /simulated cleanup transport failure/);
    assert.equal(result.runs[0].errorCode, 'SIMULATED_CLEANUP_FAILURE');
    assert.notEqual(result.runs[0].status, 'cleaned', 'failed cleanup must be visible and never reported as success');
    assert.equal(db.transactionCommitted, true);
});

test('cleanup fails closed when a persistent business side effect exists', async () => {
    const db = new FakeTrustedQaDb({
        entities: [
            { id: 1, run_id: 11, entity_type: 'booking', entity_id: 'BK-QA-1', cleanup_state: 'active' }
        ],
        sideEffectTables: { finance_transactions: 1 }
    });

    await assert.rejects(
        () => cleanupTrustedQaRun(db, 11),
        err => err instanceof TrustedQaRunError && err.code === 'QA_RUN_SIDE_EFFECT_BLOCKER'
    );
    assert.deepEqual(db.cancelledBookingIds, []);
    assert.equal(db.run.state, 'active');
});

test('cleanup still fails closed when non-queue business side effects persist', async () => {
    const db = new FakeTrustedQaDb({
        entities: [
            { id: 1, run_id: 11, entity_type: 'booking', entity_id: 'BK-QA-1', cleanup_state: 'active' }
        ],
        sideEffectTables: { event_queue: 1, finance_transactions: 1 }
    });

    await assert.rejects(
        () => cleanupTrustedQaRun(db, 11),
        err => err instanceof TrustedQaRunError && err.code === 'QA_RUN_SIDE_EFFECT_BLOCKER'
    );
    assert.deepEqual(db.cancelledBookingIds, []);
    assert.equal(db.run.state, 'active');
});

test('createTrustedQaRun stores only token hash and returns raw token to caller', async () => {
    const db = new FakeTrustedQaDb();
    const { run, token } = await createTrustedQaRun(db, {
        token: 'operator-token',
        source: 'trusted_qa',
        businessContext: 'event_genix',
        operatorUserId: 7,
        requiredCustomerId: '101',
        requiredProgramId: '501',
        requiredRoomResourceId: 'room-qa',
        requiredLineId: 'line-qa',
        allowedDate: '2026-08-14',
        allowedStartTime: '12:00',
        allowedEndTime: '18:00',
        allowedEndpoints: ['POST /api/bookings']
    });

    assert.equal(token, 'operator-token');
    assert.equal(run.token_hash, sha256('operator-token'));
    assert.equal(db.queries.some(entry => entry.params.includes('operator-token')), false);
});

test('qaPublicDetails strips empty values from route-safe error payloads', () => {
    assert.deepEqual(
        qaPublicDetails({ code: 'x', empty: '', nullable: null, ok: 'yes' }),
        { code: 'x', ok: 'yes' }
    );
});
